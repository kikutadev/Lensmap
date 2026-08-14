import type { ChatMessage } from "@deep-reader/shared";
import { create } from "zustand";
import type { DeepReaderTabState } from "../../lib/state";

export type StreamStatus = "idle" | "streaming" | "error";

export interface TabTransientState {
  documentKey: string | null;
  streamingContent: string;
  streamStatus: StreamStatus;
  composerDraft: string;
  selectedInsightId: string | null;
  actionError: string | null;
}

interface SidePanelStore {
  activeTabId: number | null;
  tabState: DeepReaderTabState | null;
  lastAssistant: ChatMessage | null;
  transientByTab: Record<string, TabTransientState>;
  view: "chat" | "insights";
  setActiveTabId: (tabId: number | null) => void;
  setTabState: (state: DeepReaderTabState | null) => void;
  setLastAssistant: (message: ChatMessage | null) => void;
  setStreamState: (tabId: number, status: StreamStatus, content?: string) => void;
  appendStreamingContent: (tabId: number, delta: string) => void;
  setComposerDraft: (tabId: number, draft: string) => void;
  setSelectedInsightId: (tabId: number, id: string | null) => void;
  setActionError: (tabId: number, error: string | null) => void;
  setView: (view: "chat" | "insights") => void;
}

export function emptyTabTransientState(documentKey: string | null = null): TabTransientState {
  return {
    documentKey,
    streamingContent: "",
    streamStatus: "idle",
    composerDraft: "",
    selectedInsightId: null,
    actionError: null,
  };
}

function tabKey(tabId: number): string {
  return String(tabId);
}

function currentTransient(state: SidePanelStore, tabId: number): TabTransientState {
  return state.transientByTab[tabKey(tabId)] ?? emptyTabTransientState();
}

export const useSidePanelStore = create<SidePanelStore>((set) => ({
  activeTabId: null,
  tabState: null,
  lastAssistant: null,
  transientByTab: {},
  view: "chat",
  setActiveTabId: (activeTabId) => set({ activeTabId }),
  setTabState: (tabState) => set((state) => {
    if (!tabState) return { tabState };
    const key = tabKey(tabState.tabId);
    const existing = state.transientByTab[key];
    const documentKey = tabState.pdfUrl;
    const transient = !existing || existing.documentKey !== documentKey
      ? emptyTabTransientState(documentKey)
      : existing;
    return {
      tabState,
      transientByTab: { ...state.transientByTab, [key]: transient },
    };
  }),
  setLastAssistant: (lastAssistant) => set({ lastAssistant }),
  setStreamState: (tabId, streamStatus, content = "") => set((state) => {
    const key = tabKey(tabId);
    const current = currentTransient(state, tabId);
    return {
      transientByTab: {
        ...state.transientByTab,
        [key]: { ...current, streamStatus, streamingContent: content },
      },
    };
  }),
  appendStreamingContent: (tabId, delta) => set((state) => {
    const key = tabKey(tabId);
    const current = currentTransient(state, tabId);
    return {
      transientByTab: {
        ...state.transientByTab,
        [key]: { ...current, streamingContent: current.streamingContent + delta },
      },
    };
  }),
  setComposerDraft: (tabId, composerDraft) => set((state) => {
    const key = tabKey(tabId);
    return {
      transientByTab: {
        ...state.transientByTab,
        [key]: { ...currentTransient(state, tabId), composerDraft },
      },
    };
  }),
  setSelectedInsightId: (tabId, selectedInsightId) => set((state) => {
    const key = tabKey(tabId);
    return {
      transientByTab: {
        ...state.transientByTab,
        [key]: { ...currentTransient(state, tabId), selectedInsightId },
      },
    };
  }),
  setActionError: (tabId, actionError) => set((state) => {
    const key = tabKey(tabId);
    return {
      transientByTab: {
        ...state.transientByTab,
        [key]: { ...currentTransient(state, tabId), actionError },
      },
    };
  }),
  setView: (view) => set({ view }),
}));
