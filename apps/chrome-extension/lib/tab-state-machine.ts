import type { ChatMessage, SelectionResolutionCandidate, SourceAnchor } from "@deep-reader/shared";

export type ExtensionStatus = "idle" | "importing" | "resolving" | "ambiguous" | "ready" | "error";

export interface DeepReaderTabState {
  tabId: number;
  status: ExtensionStatus;
  pdfUrl: string | null;
  bookId: string | null;
  selectionText: string;
  sources: SourceAnchor[];
  resolutionCandidates: SelectionResolutionCandidate[];
  threadId: string | null;
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

export interface DeepReaderStorageShape {
  deepReaderTabStates?: Record<string, DeepReaderTabState>;
  bookByPdfUrl?: Record<string, string>;
  deepReaderServerBase?: string;
  lastAssistantByTab?: Record<string, ChatMessage>;
}

export function emptyTabState(tabId: number): DeepReaderTabState {
  return {
    tabId,
    status: "idle",
    pdfUrl: null,
    bookId: null,
    selectionText: "",
    sources: [],
    resolutionCandidates: [],
    threadId: null,
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

/**
 * Build the state written synchronously at capture start.
 * A different PDF in the same Chrome tab is treated as a completely new document context.
 */
export function createCaptureStartState(
  previous: DeepReaderTabState,
  input: { pdfUrl: string; selectionText: string; focusComposer: boolean; captureId: string },
): DeepReaderTabState {
  const sameDocument = previous.pdfUrl === input.pdfUrl;
  const base = sameDocument ? previous : emptyTabState(previous.tabId);
  return {
    ...base,
    status: "importing",
    error: null,
    pdfUrl: input.pdfUrl,
    selectionText: input.selectionText,
    resolutionCandidates: [],
    composerFocusRequest: input.focusComposer
      ? base.composerFocusRequest + 1
      : base.composerFocusRequest,
    captureId: input.captureId,
  };
}

/** Reset only when navigation leaves the currently managed PDF; #page changes remain the same document. */
export function shouldResetForNavigation(state: DeepReaderTabState, nextUrl: string): boolean {
  if (!state.pdfUrl) return false;
  try {
    return canonicalDocumentUrl(nextUrl) !== state.pdfUrl;
  } catch {
    return true;
  }
}

/** Fill defaults added by newer extension versions when reading older persisted state. */
export function normalizeTabState(value: DeepReaderTabState, tabId: number): DeepReaderTabState {
  return {
    ...emptyTabState(tabId),
    ...value,
    tabId,
    captureId: value.captureId ?? null,
  };
}
