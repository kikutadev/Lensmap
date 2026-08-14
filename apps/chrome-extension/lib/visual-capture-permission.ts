import { browser } from "wxt/browser";

const VISUAL_CAPTURE_ORIGIN = "<all_urls>";

/**
 * Chrome's captureVisibleTab API requires either a tab-scoped activeTab grant or <all_urls>.
 * A Side Panel click does not grant activeTab to the PDF tab, so Lensmap requests the broad
 * host grant only at the moment the user explicitly starts Visual Capture.
 */
export async function ensureVisualCaptureHostPermission(): Promise<void> {
  if (await browser.permissions.contains({ origins: [VISUAL_CAPTURE_ORIGIN] })) return;
  const granted = await browser.permissions.request({ origins: [VISUAL_CAPTURE_ORIGIN] });
  if (!granted) {
    throw new Error("範囲選択には、表示中のPDF画面をキャプチャする追加権限が必要です。許可後にもう一度お試しください。");
  }
}

export function visualCaptureOptionalOrigin(): string {
  return VISUAL_CAPTURE_ORIGIN;
}
