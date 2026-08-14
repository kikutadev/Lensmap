import type { SelectionResolutionCandidate, SourceAnchor } from "@deep-reader/shared";
import { browser } from "wxt/browser";
import { createSource, ensureBook, resolveSelection } from "../lib/api";
import { startContextMenuAction } from "../lib/context-menu-flow";
import { ensureDeepReaderServer } from "../lib/server-startup";
import {
  clearLastAssistant,
  getTabState,
  patchTabState,
  patchTabStateForCapture,
  removeTabState,
  resetTabState,
  setTabState,
  type CaptureSelectionPayload,
} from "../lib/state";
import {
  canonicalDocumentUrl,
  createCaptureStartState,
  shouldResetForNavigation,
} from "../lib/tab-state-machine";

const MENU_DIVE = "deep-reader-dive";
const MENU_ADD = "deep-reader-add";
const CAPTURE_TIMEOUT_MS = 5 * 60 * 1000;

interface ActiveCapture {
  captureId: string;
  controller: AbortController;
  timeoutId: ReturnType<typeof setTimeout>;
}

const activeCaptures = new Map<number, ActiveCapture>();
const navigationResetSuppressedUntil = new Map<number, number>();
let contextMenuSetup: Promise<void> | null = null;

export default defineBackground({
  type: "module",
  main() {
    void scheduleContextMenuSetup();
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
      console.warn("Deep Reader: failed to configure side-panel behavior", error);
    });

    browser.runtime.onInstalled.addListener(() => { void scheduleContextMenuSetup(); });
    browser.tabs.onRemoved.addListener((tabId) => {
      abortCapture(tabId, "tab-closed");
      navigationResetSuppressedUntil.delete(tabId);
      void removeTabState(tabId);
    });
    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      void handleTabUpdate(tabId, changeInfo);
    });

    browser.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId !== MENU_DIVE && info.menuItemId !== MENU_ADD) return;
      if (tab?.id === undefined) return;

      const payload: CaptureSelectionPayload = {
        selectionText: info.selectionText?.trim() ?? "",
        pageUrl: info.pageUrl ?? tab.url ?? "",
        tabId: tab.id,
        focusComposer: info.menuItemId === MENU_DIVE,
      };

      // sidePanel.open() must be invoked directly from this context-menu user gesture.
      const run = startContextMenuAction({
        openPanel: () => tab.windowId === undefined
          ? Promise.resolve()
          : browser.sidePanel.open({ windowId: tab.windowId }),
        capture: () => beginCapture(payload),
      });

      void run.panelPromise.catch((error: unknown) => {
        // Capture remains valid even if Chrome refuses to open the panel; toolbar action can still open it later.
        console.warn("Deep Reader: side panel could not be opened from the context menu", error);
      });
      void run.capturePromise.catch((error: unknown) => {
        void persistUnhandledCaptureError(payload.tabId, error);
      });
    });

    browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      const request = asRuntimeMessage(message);
      if (!request) return false;
      if (sender.id !== browser.runtime.id) return false;

      if (request.type === "ensure-server") {
        void ensureDeepReaderServer()
          .then(() => sendResponse({ ok: true }))
          .catch((error: unknown) => sendResponse({ ok: false, error: toMessage(error) }));
        return true;
      }

      if (request.type === "probe-capture-selection") {
        void beginCapture(request.payload)
          .then((state) => sendResponse({ ok: true, state }))
          .catch(async (error: unknown) => {
            await persistUnhandledCaptureError(request.payload.tabId, error);
            sendResponse({ ok: false, error: toMessage(error) });
          });
        return true;
      }

      if (request.type === "resolve-selection-candidate") {
        void materializeCandidate(request.tabId, request.candidateIndex)
          .then((state) => sendResponse({ ok: true, state }))
          .catch((error: unknown) => sendResponse({ ok: false, error: toMessage(error) }));
        return true;
      }

      if (request.type === "open-citation") {
        void openCitation(request.tabId, request.page)
          .then(() => sendResponse({ ok: true }))
          .catch((error: unknown) => sendResponse({ ok: false, error: toMessage(error) }));
        return true;
      }

      if (request.type === "cancel-capture") {
        const cancelled = abortCapture(request.tabId, "user-cancelled", false);
        sendResponse({ ok: true, cancelled });
        return false;
      }

      return false;
    });
  },
});

function scheduleContextMenuSetup(): Promise<void> {
  if (contextMenuSetup) return contextMenuSetup;
  contextMenuSetup = ensureContextMenus().finally(() => {
    contextMenuSetup = null;
  });
  return contextMenuSetup;
}

async function ensureContextMenus(): Promise<void> {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: MENU_DIVE,
    title: "Deep Readerで深掘り",
    contexts: ["selection"],
  });
  browser.contextMenus.create({
    id: MENU_ADD,
    title: "Deep Readerの引用に追加",
    contexts: ["selection"],
  });
}

/** Start a cancellable capture while invalidating any older capture for the same tab. */
async function beginCapture(payload: CaptureSelectionPayload) {
  const selectionText = payload.selectionText.trim();
  if (!selectionText) throw new Error("選択テキストを取得できませんでした");
  if (!/^https?:|^file:/u.test(payload.pageUrl)) {
    throw new Error(`未対応のPDF URLです: ${payload.pageUrl || "(empty)"}`);
  }
  if (payload.pageUrl.startsWith("file:")) {
    const allowed = await browser.extension.isAllowedFileSchemeAccess();
    if (!allowed) {
      throw new Error("ローカルPDFを読むには、Chromeの拡張機能詳細で「ファイルの URL へのアクセスを許可する」を有効にしてください。");
    }
  }

  const pdfUrl = canonicalDocumentUrl(payload.pageUrl);
  abortCapture(payload.tabId, "superseded");

  const captureId = crypto.randomUUID();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException("PDFの取り込みがタイムアウトしました", "TimeoutError"));
  }, CAPTURE_TIMEOUT_MS);
  activeCaptures.set(payload.tabId, { captureId, controller, timeoutId });

  try {
    const previous = await getTabState(payload.tabId);
    assertCurrentCapture(payload.tabId, captureId, controller.signal);
    const documentChanged = previous.pdfUrl !== null && previous.pdfUrl !== pdfUrl;
    const started = createCaptureStartState(previous, {
      pdfUrl,
      selectionText,
      focusComposer: payload.focusComposer === true,
      captureId,
    });
    await setTabState(payload.tabId, started);
    if (documentChanged) await clearLastAssistant(payload.tabId);

    await ensureDeepReaderServer(controller.signal);
    assertCurrentCapture(payload.tabId, captureId, controller.signal);
    const book = await ensureBook(pdfUrl, controller.signal);
    assertCurrentCapture(payload.tabId, captureId, controller.signal);
    const resolving = await patchTabStateForCapture(payload.tabId, captureId, {
      status: "resolving",
      bookId: book.id,
      pdfUrl,
      selectionText,
      error: null,
    });
    if (!resolving) throw staleCaptureError();

    const resolution = await resolveSelection(book.id, selectionText, controller.signal);
    assertCurrentCapture(payload.tabId, captureId, controller.signal);
    if (resolution.candidates.length === 0) {
      throw new Error("選択箇所をPDF索引へ再同定できませんでした");
    }
    if (resolution.candidates.length > 1) {
      const ambiguous = await patchTabStateForCapture(payload.tabId, captureId, {
        status: "ambiguous",
        bookId: book.id,
        pdfUrl,
        selectionText,
        resolutionCandidates: resolution.candidates,
        capturedAt: new Date().toISOString(),
        captureId: null,
      });
      if (!ambiguous) throw staleCaptureError();
      return ambiguous;
    }

    return await materializeResolvedCandidate(
      payload.tabId,
      book.id,
      resolution.candidates[0]!,
      { captureId, signal: controller.signal },
    );
  } catch (error: unknown) {
    const active = activeCaptures.get(payload.tabId);
    if (active?.captureId === captureId) {
      const message = captureErrorMessage(error, controller.signal);
      await patchTabStateForCapture(payload.tabId, captureId, {
        status: "error",
        error: message,
        captureId: null,
      });
    }
    throw error;
  } finally {
    const active = activeCaptures.get(payload.tabId);
    if (active?.captureId === captureId) {
      clearTimeout(active.timeoutId);
      activeCaptures.delete(payload.tabId);
    }
  }
}

async function materializeCandidate(tabId: number, candidateIndex: number) {
  const state = await getTabState(tabId);
  if (!state.bookId) throw new Error("対象PDFがありません");
  const candidate = state.resolutionCandidates[candidateIndex];
  if (!candidate) throw new Error("選択候補が見つかりません");
  return materializeResolvedCandidate(tabId, state.bookId, candidate);
}

async function materializeResolvedCandidate(
  tabId: number,
  bookId: string,
  candidate: SelectionResolutionCandidate,
  capture?: { captureId: string; signal: AbortSignal },
) {
  if (capture) assertCurrentCapture(tabId, capture.captureId, capture.signal);
  const state = await getTabState(tabId);
  if (capture && state.captureId !== capture.captureId) throw staleCaptureError();
  if (state.bookId && state.bookId !== bookId) throw staleCaptureError();

  const existing = state.sources.find((source) => sameSource(source, candidate));
  const source = existing ?? await createSource(
    bookId,
    { ...candidate, origin: "user-selection" },
    capture?.signal,
  );
  if (capture) assertCurrentCapture(tabId, capture.captureId, capture.signal);

  const latest = await getTabState(tabId);
  if (capture && latest.captureId !== capture.captureId) throw staleCaptureError();
  if (latest.bookId && latest.bookId !== bookId) throw staleCaptureError();
  const sources = dedupeSources([...latest.sources, source]);
  const patch = {
    status: "ready" as const,
    error: null,
    bookId,
    sources,
    resolutionCandidates: [],
    capturedAt: new Date().toISOString(),
    captureId: null,
  };
  if (capture) {
    const resolved = await patchTabStateForCapture(tabId, capture.captureId, patch);
    if (!resolved) throw staleCaptureError();
    return resolved;
  }
  return patchTabState(tabId, patch);
}

async function handleTabUpdate(
  tabId: number,
  changeInfo: { url?: string; status?: string },
): Promise<void> {
  const state = await getTabState(tabId);
  if (!state.pdfUrl) return;

  if (changeInfo.url) {
    if (!shouldResetForNavigation(state, changeInfo.url)) return;
    abortCapture(tabId, "navigation");
    await resetTabState(tabId);
    return;
  }

  if (changeInfo.status !== "loading") return;
  if ((navigationResetSuppressedUntil.get(tabId) ?? 0) > Date.now()) return;

  // Without the broad `tabs` permission Chrome may hide the URL after activeTab is revoked.
  // A hidden URL during navigation is sufficient reason to clear document-bound state.
  let currentUrl: string | undefined;
  try {
    currentUrl = (await browser.tabs.get(tabId)).url;
  } catch {
    currentUrl = undefined;
  }
  if (currentUrl && !shouldResetForNavigation(state, currentUrl)) return;

  abortCapture(tabId, "navigation");
  await resetTabState(tabId);
}

function abortCapture(
  tabId: number,
  reason: "user-cancelled" | "superseded" | "navigation" | "tab-closed",
  release = true,
): boolean {
  const active = activeCaptures.get(tabId);
  if (!active) return false;
  clearTimeout(active.timeoutId);
  const message = reason === "user-cancelled"
    ? "PDFの取り込みをキャンセルしました"
    : reason === "navigation"
      ? "PDFから移動したため取り込みを中止しました"
      : "新しい処理のため古い取り込みを中止しました";
  active.controller.abort(new DOMException(message, "AbortError"));
  if (release) activeCaptures.delete(tabId);
  return true;
}

async function persistUnhandledCaptureError(tabId: number, error: unknown): Promise<void> {
  // A newer capture owns the tab, so an older/preflight failure must never overwrite it.
  if (activeCaptures.has(tabId)) return;
  const state = await getTabState(tabId);
  if (state.status === "importing" || state.status === "resolving") return;
  const message = toMessage(error);
  if (state.status === "error" && state.error === message) return;
  await patchTabState(tabId, { status: "error", error: message, captureId: null });
}

function assertCurrentCapture(tabId: number, captureId: string, signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : staleCaptureError();
  if (activeCaptures.get(tabId)?.captureId !== captureId) throw staleCaptureError();
}

function staleCaptureError(): DOMException {
  return new DOMException("古いPDF取り込み処理を破棄しました", "AbortError");
}

function captureErrorMessage(error: unknown, signal: AbortSignal): string {
  if (signal.reason instanceof Error) return signal.reason.message;
  if (error instanceof DOMException && error.name === "AbortError") return "PDFの取り込みをキャンセルしました";
  return toMessage(error);
}

async function openCitation(tabId: number, page: number): Promise<void> {
  const state = await getTabState(tabId);
  if (!state.pdfUrl) throw new Error("PDF URLがありません");
  const url = new URL(state.pdfUrl);
  url.hash = `page=${Math.max(1, Math.floor(page))}`;
  const targetUrl = url.toString();
  navigationResetSuppressedUntil.set(tabId, Date.now() + 5_000);
  await browser.tabs.update(tabId, { url: targetUrl, active: true });
  await waitForOwnCitationNavigation(tabId, targetUrl);
  // Chrome's built-in PDF viewer applies #page open parameters at document load, not a hash-only navigation.
  // tabs.update/get/reload themselves do not require the broad `tabs` permission; activeTab covers URL visibility
  // for the PDF tab while this user-initiated citation navigation is in progress.
  await browser.tabs.reload(tabId);
}

/** Wait until Chrome has committed our own same-document fragment before reloading the built-in PDF viewer. */
async function waitForOwnCitationNavigation(tabId: number, targetUrl: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  let urlWasVisible = false;
  while (Date.now() < deadline) {
    const tab = await browser.tabs.get(tabId);
    if (tab.url) {
      urlWasVisible = true;
      if (tab.url === targetUrl) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  // If Chrome redacted URL after the activeTab grant was revoked during navigation, the bounded wait above
  // still gives the fragment navigation time to commit. A visible non-target URL is an actual failure.
  if (urlWasVisible) throw new Error(`PDFページURLへの遷移がタイムアウトしました: ${targetUrl}`);
}

function sameSource(source: SourceAnchor, candidate: SelectionResolutionCandidate): boolean {
  return source.pageStart === candidate.pageStart
    && source.pageEnd === candidate.pageEnd
    && source.quoteNormalized === candidate.quoteNormalized;
}

function dedupeSources(sources: SourceAnchor[]): SourceAnchor[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.pageStart}:${source.pageEnd}:${source.textHash}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRuntimeMessage(value: unknown):
  | { type: "ensure-server" }
  | { type: "probe-capture-selection"; payload: CaptureSelectionPayload }
  | { type: "resolve-selection-candidate"; tabId: number; candidateIndex: number }
  | { type: "open-citation"; tabId: number; page: number }
  | { type: "cancel-capture"; tabId: number }
  | null {
  if (!value || typeof value !== "object" || !("type" in value)) return null;
  const message = value as Record<string, unknown>;
  if (message.type === "ensure-server") return { type: "ensure-server" };
  if (message.type === "probe-capture-selection" && isCapturePayload(message.payload)) {
    return { type: message.type, payload: message.payload };
  }
  if (message.type === "resolve-selection-candidate" && Number.isInteger(message.tabId) && Number.isInteger(message.candidateIndex)) {
    return { type: message.type, tabId: Number(message.tabId), candidateIndex: Number(message.candidateIndex) };
  }
  if (message.type === "open-citation" && Number.isInteger(message.tabId) && Number.isInteger(message.page)) {
    return { type: message.type, tabId: Number(message.tabId), page: Number(message.page) };
  }
  if (message.type === "cancel-capture" && Number.isInteger(message.tabId)) {
    return { type: message.type, tabId: Number(message.tabId) };
  }
  return null;
}

function isCapturePayload(value: unknown): value is CaptureSelectionPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.selectionText === "string"
    && typeof payload.pageUrl === "string"
    && Number.isInteger(payload.tabId)
    && (payload.focusComposer === undefined || typeof payload.focusComposer === "boolean");
}
