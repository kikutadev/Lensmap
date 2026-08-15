import { browser } from "wxt/browser";
import { t } from "./i18n/runtime";

interface EnsureServerResponse {
  ok?: boolean;
  error?: string;
}

/** Request on-demand server startup through the background service worker. */
export async function requestServerStartup(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
  }

  const response = await browser.runtime.sendMessage({ type: "ensure-server" }) as EnsureServerResponse | undefined;

  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
  }
  if (!response?.ok) throw new Error(response?.error ?? t("errors.serverStartRequestFailed"));
}
