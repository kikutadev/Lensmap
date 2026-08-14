import { browser } from "wxt/browser";
import { getServerBase } from "./state";

const NATIVE_HOST_NAME = "com.deepreader.launcher";
const HEALTH_CHECK_TIMEOUT_MS = 1_200;
const SERVER_START_TIMEOUT_MS = 12_000;
const SERVER_START_POLL_MS = 150;

interface NativeHostResponse {
  ok?: boolean;
  state?: "already-running" | "started";
  message?: string;
}

let startPromise: Promise<void> | null = null;

/** Ensure the local Deep Reader Server is available, starting it through Chrome Native Messaging only when needed. */
export async function ensureDeepReaderServer(signal?: AbortSignal): Promise<void> {
  if (await isDeepReaderServerHealthy(signal)) return;

  if (!startPromise) {
    startPromise = startServerViaNativeHost().finally(() => {
      startPromise = null;
    });
  }

  await waitWithAbort(startPromise, signal);
}

/** Perform a bounded health check without triggering any local process startup. */
export async function isDeepReaderServerHealthy(signal?: AbortSignal): Promise<boolean> {
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

/** Ask Chrome to launch the registered Native Messaging host, then wait for the HTTP server to become healthy. */
async function startServerViaNativeHost(): Promise<void> {
  let response: NativeHostResponse;
  try {
    response = await browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      command: "ensure-server",
    }) as NativeHostResponse;
  } catch (error: unknown) {
    throw new Error(
      `Deep Reader Serverを自動起動できません。Native Hostの初回セットアップを確認してください。${formatCause(error)}`,
    );
  }

  if (!response?.ok) {
    throw new Error(response?.message ?? "Deep Reader Serverの起動要求に失敗しました。");
  }

  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isDeepReaderServerHealthy()) return;
    await delay(SERVER_START_POLL_MS);
  }

  throw new Error("Deep Reader Serverの起動を要求しましたが、接続可能になるまでにタイムアウトしました。");
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
