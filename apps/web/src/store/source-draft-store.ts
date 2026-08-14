import { create } from "zustand";
import type { SourceAnchor } from "@deep-reader/shared";

interface SourceDraftState {
  attachedSources: SourceAnchor[];
  composerFocusRequest: number;
  attachSource: (source: SourceAnchor) => void;
  removeSource: (sourceId: string) => void;
  clearSources: () => void;
  requestComposerFocus: () => void;
}

/** Hold only the sources attached to the not-yet-submitted turn; persisted anchors live on the server. */
export const useSourceDraftStore = create<SourceDraftState>((set) => ({
  attachedSources: [],
  composerFocusRequest: 0,
  attachSource: (source) =>
    set((state) => ({
      attachedSources: state.attachedSources.some((item) => item.id === source.id)
        ? state.attachedSources
        : [...state.attachedSources, source],
    })),
  removeSource: (sourceId) =>
    set((state) => ({
      attachedSources: state.attachedSources.filter((source) => source.id !== sourceId),
    })),
  clearSources: () => set({ attachedSources: [] }),
  requestComposerFocus: () =>
    set((state) => ({ composerFocusRequest: state.composerFocusRequest + 1 })),
}));
