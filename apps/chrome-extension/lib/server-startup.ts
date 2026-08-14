import { browser } from "wxt/browser";
import { getCapabilityToken, getServerBase, setCapabilityToken } from "./state";

const NATIVE_HOST_NAME = "com.lensmap.launcher";
const HEALTH_CHECK_TIMEOUT_MS = 1_200;
const SERVER_START_TIMEOUT_MS = 12_000;
const SERVER_START_POLL_MS = 150;

interface NativeHostResponse {
  ok?: boolean;
  state?: "already-running" | "started";
  capabilityToken?: string;
  message?: string;
}

let startPromise: Promise<void> | null = null;

/** Ensure both the local server and the session-only capability needed to access it are available. */
export async function ensureLensmapServer(signal?: AbortSignal): Promise<void> {
  const [healthy, capabilityToken] = await Promise.all([
    isLensmapServerHealthy(signal),
    getCapabilityToken(),
  ]);
  if (healthy && capabilityToken) return;

  if (!startPromise) {
    startPromise = synchronizeServerCapabilityViaNativeHost().finally(() => {
      startPromise = null;
    });
  }

  await waitWithAbort(startPromise, signal);
}

/** Perform a bounded public health check without triggering local process startup. */
export async function isLensmapServerHealthy(signal?: AbortSignal): Promise<boolean> {
  const serverBase = await getServerBase();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const response = await fetch(`${serverBase}/health`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch (error: unknown) {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : error;
    }
    return false;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

/** Ask the trusted Native Messaging host for the current server capability, starting/upgrading the server if needed. */
async function synchronizeServerCapabilityViaNativeHost(): Promise<void> {
  let response: NativeHostResponse;
  try {
    response = await browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      command: "ensure-server",
    }) as NativeHostResponse;
  } catch (error: unknown) {
    throw new Error(
      `Lensmap Serverを自動起動できません。Native Hostの初回セットアップを確認してください。${formatCause(error)}`,
    );
  }

  if (!response?.ok) {
    throw new Error(response?.message ?? "Lensmap Serverの起動要求に失敗しました。");
  }
  if (typeof response.capabilityToken !== "string" || response.capabilityToken.length < 32) {
    throw new Error("Native HostからLensmap Serverの接続権限を取得できませんでした。");
  }
  await setCapabilityToken(response.capabilityToken);

  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isLensmapServerHealthy()) return;
    await delay(SERVER_START_POLL_MS);
  }

  throw new Error("Lensmap Serverの起動を要求しましたが、接続可能になるまでにタイムアウトしました。");
}

/** Await a shared startup operation while allowing an individual caller to stop waiting independently. */
async function waitWithAbort(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return promise;
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCause(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message ? ` (${message})` : "";
}
