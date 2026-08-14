import type { SelectionResolutionCandidate } from "@lensmap/shared";
import { browser } from "wxt/browser";
import { addWorkspaceBook, addWorkspaceSource, createSource, createWorkspace, ensureBook, fetchWorkspace, resolveSelection } from "../lib/api";
import { startContextMenuAction } from "../lib/context-menu-flow";
import { ensureLensmapServer } from "../lib/server-startup";
import {
  getActiveWorkspaceId,
  getBookTabLocation,
  getTabState,
  patchTabState,
  patchTabStateForCapture,
  removeTabState,
  resetTabState,
  setActiveWorkspaceId,
  setBookTabLocation,
  setTabState,
  type CaptureSelectionPayload,
} from "../lib/state";
import {
  canonicalDocumentUrl,
  createCaptureStartState,
  shouldResetForNavigation,
} from "../lib/tab-state-machine";

const MENU_EXPLORE = "lensmap-explore";
const MENU_ADD_REFERENCE = "lensmap-add-reference";
const MENU_CAPTURE_REGION = "lensmap-capture-region";
const CAPTURE_TIMEOUT_MS = 5 * 60 * 1000;

interface ActiveCapture {
  captureId: string;
  controller: AbortController;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface PendingVisualCapture {
  captureId: string;
  dataUrl: string;
  originTabId: number;
  bookId: string;
  workspaceId: string;
  timeoutId: ReturnType<typeof setTimeout>;
}

const activeCaptures = new Map<number, ActiveCapture>();
const pendingVisualCaptures = new Map<string, PendingVisualCapture>();
const navigationResetSuppressedUntil = new Map<number, number>();
let contextMenuSetup: Promise<void> | null = null;

export default defineBackground({
  type: "module",
  main() {
    void scheduleContextMenuSetup();
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
      console.warn("Lensmap: failed to configure side-panel behavior", error);
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
      if (tab?.id === undefined) return;
      if (info.menuItemId === MENU_CAPTURE_REGION) {
        void beginVisualCaptureFromMenu(tab.id).catch((error: unknown) => persistUnhandledCaptureError(tab.id!, error));
        return;
      }
      if (info.menuItemId !== MENU_EXPLORE && info.menuItemId !== MENU_ADD_REFERENCE) return;

      const payload: CaptureSelectionPayload = {
        selectionText: info.selectionText?.trim() ?? "",
        pageUrl: info.pageUrl ?? tab.url ?? "",
        tabId: tab.id,
        focusComposer: info.menuItemId === MENU_EXPLORE,
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
        console.warn("Lensmap: side panel could not be opened from the context menu", error);
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
        void ensureLensmapServer()
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
        void openCitation(request.bookId, request.page)
          .then(() => sendResponse({ ok: true }))
          .catch((error: unknown) => sendResponse({ ok: false, error: toMessage(error) }));
        return true;
      }

      if (request.type === "begin-visual-capture") {
        void beginVisualCapture(request.tabId, request.workspaceId)
          .then((captureId) => sendResponse({ ok: true, captureId }))
          .catch((error: unknown) => sendResponse({ ok: false, error: toMessage(error) }));
        return true;
      }

      if (request.type === "get-visual-capture") {
        const capture = pendingVisualCaptures.get(request.captureId);
        if (!capture) sendResponse({ ok: false, error: "Visual Captureは期限切れです。PDFからもう一度開始してください。" });
        else sendResponse({ ok: true, capture: { captureId: capture.captureId, dataUrl: capture.dataUrl, originTabId: capture.originTabId, bookId: capture.bookId, workspaceId: capture.workspaceId } });
        return false;
      }

      if (request.type === "finish-visual-capture") {
        void finishVisualCapture(request.captureId, sender.tab?.id)
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
    id: MENU_EXPLORE,
    title: "LensmapでExplore",
    contexts: ["selection"],
  });
  browser.contextMenus.create({
    id: MENU_ADD_REFERENCE,
    title: "Lensmapの参照に追加",
    contexts: ["selection"],
  });
  browser.contextMenus.create({
    id: MENU_CAPTURE_REGION,
    title: "Lensmapで範囲を選択",
    contexts: ["page"],
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
    const started = createCaptureStartState(previous, {
      pdfUrl,
      selectionText,
      focusComposer: payload.focusComposer === true,
      captureId,
    });
    await setTabState(payload.tabId, started);

    await ensureLensmapServer(controller.signal);
    assertCurrentCapture(payload.tabId, captureId, controller.signal);
    const book = await ensureBook(pdfUrl, controller.signal);
    const workspaceId = await ensureActiveWorkspaceForBook(book.id, book.title);
    await setBookTabLocation(book.id, { tabId: payload.tabId, pdfUrl });
    assertCurrentCapture(payload.tabId, captureId, controller.signal);
    const resolving = await patchTabStateForCapture(payload.tabId, captureId, {
      status: "resolving",
      bookId: book.id,
      workspaceId,
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
        workspaceId,
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
      workspaceId,
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
  if (!state.bookId || !state.workspaceId) throw new Error("対象WorkspaceまたはPDFがありません");
  const candidate = state.resolutionCandidates[candidateIndex];
  if (!candidate) throw new Error("選択候補が見つかりません");
  return materializeResolvedCandidate(tabId, state.bookId, state.workspaceId, candidate);
}

async function materializeResolvedCandidate(
  tabId: number,
  bookId: string,
  workspaceId: string,
  candidate: SelectionResolutionCandidate,
  capture?: { captureId: string; signal: AbortSignal },
) {
  if (capture) assertCurrentCapture(tabId, capture.captureId, capture.signal);
  const state = await getTabState(tabId);
  if (capture && state.captureId !== capture.captureId) throw staleCaptureError();
  if ((state.bookId && state.bookId !== bookId) || (state.workspaceId && state.workspaceId !== workspaceId)) throw staleCaptureError();

  const source = await createSource(
    bookId,
    { ...candidate, origin: "user-selection" },
    capture?.signal,
  );
  await addWorkspaceSource(workspaceId, source.id);
  await browser.storage.local.set({ "lensmap.workspaceRevision": Date.now() });
  if (capture) assertCurrentCapture(tabId, capture.captureId, capture.signal);

  const latest = await getTabState(tabId);
  if (capture && latest.captureId !== capture.captureId) throw staleCaptureError();
  if ((latest.bookId && latest.bookId !== bookId) || (latest.workspaceId && latest.workspaceId !== workspaceId)) throw staleCaptureError();
  const patch = {
    status: "ready" as const,
    error: null,
    bookId,
    workspaceId,
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

async function beginVisualCaptureFromMenu(tabId: number): Promise<string> {
  const state = await getTabState(tabId);
  if (!state.bookId) throw new Error("先にテキスト選択等でPDFをLensmapへ認識させてください");
  let workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    const workspace = await createWorkspace({ bookId: state.bookId });
    workspaceId = workspace.id;
    await setActiveWorkspaceId(workspaceId);
  }
  return beginVisualCapture(tabId, workspaceId);
}

async function beginVisualCapture(tabId: number, workspaceId: string): Promise<string> {
  const state = await getTabState(tabId);
  if (!state.bookId || !state.pdfUrl) throw new Error("Visual CaptureはLensmapで認識済みのPDFタブから開始してください");
  const tab = await browser.tabs.get(tabId);
  if (tab.windowId === undefined) throw new Error("PDFタブのWindowを特定できませんでした");
  const workspace = await fetchWorkspace(workspaceId);
  if (!workspace.books.some((book) => book.id === state.bookId)) await addWorkspaceBook(workspaceId, state.bookId);
  const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  if (!dataUrl.startsWith("data:image/png")) throw new Error("表示中PDFのPNG Captureに失敗しました");
  const captureId = crypto.randomUUID();
  const timeoutId = setTimeout(() => clearVisualCapture(captureId), CAPTURE_TIMEOUT_MS);
  pendingVisualCaptures.set(captureId, { captureId, dataUrl, originTabId: tabId, bookId: state.bookId, workspaceId, timeoutId });
  try {
    await browser.tabs.create({
      url: browser.runtime.getURL(('/visual-capture.html?captureId=' + encodeURIComponent(captureId)) as never),
      active: true,
      windowId: tab.windowId,
    });
  } catch (error) {
    clearVisualCapture(captureId);
    throw error;
  }
  return captureId;
}

async function finishVisualCapture(captureId: string, captureTabId?: number): Promise<void> {
  const capture = pendingVisualCaptures.get(captureId);
  if (!capture) return;
  clearVisualCapture(captureId);
  try { await browser.tabs.update(capture.originTabId, { active: true }); } catch { /* source PDF tab may have closed */ }
  if (captureTabId !== undefined && captureTabId !== capture.originTabId) {
    try { await browser.tabs.remove(captureTabId); } catch { /* capture tab may already be closing */ }
  }
}

function clearVisualCapture(captureId: string): void {
  const capture = pendingVisualCaptures.get(captureId);
  if (!capture) return;
  clearTimeout(capture.timeoutId);
  pendingVisualCaptures.delete(captureId);
}

async function ensureActiveWorkspaceForBook(bookId: string, bookTitle: string): Promise<string> {
  const activeId = await getActiveWorkspaceId();
  if (activeId) {
    try {
      const workspace = await fetchWorkspace(activeId);
      if (!workspace.books.some((book) => book.id === bookId)) await addWorkspaceBook(activeId, bookId);
      return activeId;
    } catch {
      // The local data directory may have been reset; create a fresh Workspace below.
    }
  }
  const workspace = await createWorkspace({ name: bookTitle, bookId });
  await setActiveWorkspaceId(workspace.id);
  return workspace.id;
}

async function openCitation(bookId: string, page: number): Promise<void> {
  const location = await getBookTabLocation(bookId);
  if (!location) throw new Error("このPDFのURL情報がありません");
  const url = new URL(location.pdfUrl);
  url.hash = `page=${Math.max(1, Math.floor(page))}`;
  const targetUrl = url.toString();

  let tabId = location.tabId;
  try {
    await browser.tabs.get(tabId);
    navigationResetSuppressedUntil.set(tabId, Date.now() + 5_000);
    await browser.tabs.update(tabId, { url: targetUrl, active: true });
  } catch {
    const created = await browser.tabs.create({ url: targetUrl, active: true });
    if (created.id === undefined) throw new Error("PDFタブを開けませんでした");
    tabId = created.id;
    await setBookTabLocation(bookId, { tabId, pdfUrl: location.pdfUrl });
  }
  await waitForOwnCitationNavigation(tabId, targetUrl);
  await browser.tabs.reload(tabId);
}

/** Wait until Chrome has committed our own PDF page fragment before reloading the built-in PDF viewer. */
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
  if (urlWasVisible) throw new Error(`PDFページURLへの遷移がタイムアウトしました: ${targetUrl}`);
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRuntimeMessage(value: unknown):
  | { type: "ensure-server" }
  | { type: "probe-capture-selection"; payload: CaptureSelectionPayload }
  | { type: "resolve-selection-candidate"; tabId: number; candidateIndex: number }
  | { type: "open-citation"; bookId: string; page: number }
  | { type: "begin-visual-capture"; tabId: number; workspaceId: string }
  | { type: "get-visual-capture"; captureId: string }
  | { type: "finish-visual-capture"; captureId: string; committed: boolean; sourceId?: string }
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
  if (message.type === "open-citation" && typeof message.bookId === "string" && message.bookId && Number.isInteger(message.page)) {
    return { type: message.type, bookId: message.bookId, page: Number(message.page) };
  }
  if (message.type === "begin-visual-capture" && Number.isInteger(message.tabId) && typeof message.workspaceId === "string" && message.workspaceId) {
    return { type: message.type, tabId: Number(message.tabId), workspaceId: message.workspaceId };
  }
  if (message.type === "get-visual-capture" && typeof message.captureId === "string" && message.captureId) {
    return { type: message.type, captureId: message.captureId };
  }
  if (message.type === "finish-visual-capture" && typeof message.captureId === "string" && message.captureId && typeof message.committed === "boolean") {
    return { type: message.type, captureId: message.captureId, committed: message.committed, ...(typeof message.sourceId === "string" ? { sourceId: message.sourceId } : {}) };
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
