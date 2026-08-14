import { create } from "zustand";
import type { LensmapTabState } from "../../lib/state";

export type StreamStatus = "idle" | "streaming" | "error";
export type LensmapView = "explore" | "maps";

export interface WorkspaceTransientState {
  streamingContent: string;
  streamStatus: StreamStatus;
  composerDraft: string;
  selectedMapId: string | null;
  actionError: string | null;
  modelOverride: string | null;
  activeThreadId: string | null;
}

interface SidePanelStore {
  activeTabId: number | null;
  tabState: LensmapTabState | null;
  activeWorkspaceId: string | null;
  transientByWorkspace: Record<string, WorkspaceTransientState>;
  view: LensmapView;
  setActiveTabId: (tabId: number | null) => void;
  setTabState: (state: LensmapTabState | null) => void;
  setActiveWorkspaceId: (workspaceId: string | null) => void;
  setStreamState: (workspaceId: string, status: StreamStatus, content?: string) => void;
  appendStreamingContent: (workspaceId: string, delta: string) => void;
  setComposerDraft: (workspaceId: string, draft: string) => void;
  setSelectedMapId: (workspaceId: string, id: string | null) => void;
  setActionError: (workspaceId: string, error: string | null) => void;
  setModelOverride: (workspaceId: string, model: string | null) => void;
  setActiveThreadId: (workspaceId: string, threadId: string | null) => void;
  setView: (view: LensmapView) => void;
}

export function emptyWorkspaceTransientState(): WorkspaceTransientState {
  return {
    streamingContent: "",
    streamStatus: "idle",
    composerDraft: "",
    selectedMapId: null,
    actionError: null,
    modelOverride: null,
    activeThreadId: null,
  };
}

function currentTransient(state: SidePanelStore, workspaceId: string): WorkspaceTransientState {
  return state.transientByWorkspace[workspaceId] ?? emptyWorkspaceTransientState();
}

function patchWorkspace(
  state: SidePanelStore,
  workspaceId: string,
  patch: Partial<WorkspaceTransientState>,
): Pick<SidePanelStore, "transientByWorkspace"> {
  return {
    transientByWorkspace: {
      ...state.transientByWorkspace,
      [workspaceId]: { ...currentTransient(state, workspaceId), ...patch },
    },
  };
}

export const useSidePanelStore = create<SidePanelStore>((set) => ({
  activeTabId: null,
  tabState: null,
  activeWorkspaceId: null,
  transientByWorkspace: {},
  view: "explore",
  setActiveTabId: (activeTabId) => set({ activeTabId }),
  setTabState: (tabState) => set({ tabState }),
  setActiveWorkspaceId: (activeWorkspaceId) => set((state) => ({
    activeWorkspaceId,
    transientByWorkspace: activeWorkspaceId && !state.transientByWorkspace[activeWorkspaceId]
      ? { ...state.transientByWorkspace, [activeWorkspaceId]: emptyWorkspaceTransientState() }
      : state.transientByWorkspace,
  })),
  setStreamState: (workspaceId, streamStatus, streamingContent = "") => set((state) => patchWorkspace(state, workspaceId, { streamStatus, streamingContent })),
  appendStreamingContent: (workspaceId, delta) => set((state) => patchWorkspace(state, workspaceId, { streamingContent: currentTransient(state, workspaceId).streamingContent + delta })),
  setComposerDraft: (workspaceId, composerDraft) => set((state) => patchWorkspace(state, workspaceId, { composerDraft })),
  setSelectedMapId: (workspaceId, selectedMapId) => set((state) => patchWorkspace(state, workspaceId, { selectedMapId })),
  setActionError: (workspaceId, actionError) => set((state) => patchWorkspace(state, workspaceId, { actionError })),
  setModelOverride: (workspaceId, modelOverride) => set((state) => patchWorkspace(state, workspaceId, { modelOverride })),
  setActiveThreadId: (workspaceId, activeThreadId) => set((state) => patchWorkspace(state, workspaceId, { activeThreadId })),
  setView: (view) => set({ view }),
}));
