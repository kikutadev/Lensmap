import type { SelectionResolutionCandidate } from "@lensmap/shared";

export type ExtensionStatus = "idle" | "importing" | "resolving" | "ambiguous" | "ready" | "error";

/** Chrome-tab state is deliberately limited to the current PDF/capture operation. Knowledge state belongs to Reader Workspace. */
export interface LensmapTabState {
  tabId: number;
  status: ExtensionStatus;
  pdfUrl: string | null;
  bookId: string | null;
  workspaceId: string | null;
  selectionText: string;
  resolutionCandidates: SelectionResolutionCandidate[];
  error: string | null;
  capturedAt: string | null;
  composerFocusRequest: number;
  captureId: string | null;
}

export interface CaptureSelectionPayload {
  selectionText: string;
  pageUrl: string;
  tabId: number;
  focusComposer?: boolean;
}

export interface LensmapStorageShape {
  "lensmap.serverBase"?: string;
  "lensmap.bookByPdfUrl"?: Record<string, string>;
  "lensmap.activeWorkspaceId"?: string;
}

export function emptyTabState(tabId: number): LensmapTabState {
  return {
    tabId,
    status: "idle",
    pdfUrl: null,
    bookId: null,
    workspaceId: null,
    selectionText: "",
    resolutionCandidates: [],
    error: null,
    capturedAt: null,
    composerFocusRequest: 0,
    captureId: null,
  };
}

/** Normalize a document URL so PDF viewer hash navigation does not create a new document identity. */
export function canonicalDocumentUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

/** Begin a new capture while preserving only same-document capture metadata. */
export function createCaptureStartState(
  previous: LensmapTabState,
  input: { pdfUrl: string; selectionText: string; focusComposer: boolean; captureId: string },
): LensmapTabState {
  const sameDocument = previous.pdfUrl === input.pdfUrl;
  const base = sameDocument ? previous : emptyTabState(previous.tabId);
  return {
    ...base,
    status: "importing",
    error: null,
    pdfUrl: input.pdfUrl,
    selectionText: input.selectionText,
    resolutionCandidates: [],
    composerFocusRequest: input.focusComposer ? base.composerFocusRequest + 1 : base.composerFocusRequest,
    captureId: input.captureId,
  };
}

/** Reset capture metadata only when navigation leaves the current PDF; Workspace state is intentionally unaffected. */
export function shouldResetForNavigation(state: LensmapTabState, nextUrl: string): boolean {
  if (!state.pdfUrl) return false;
  try { return canonicalDocumentUrl(nextUrl) !== state.pdfUrl; } catch { return true; }
}

export function normalizeTabState(value: LensmapTabState, tabId: number): LensmapTabState {
  return { ...emptyTabState(tabId), ...value, tabId, captureId: value.captureId ?? null };
}
