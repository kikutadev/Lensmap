import { create } from "zustand";

export interface ReaderOutlineItem {
  id: string;
  title: string;
  page: number;
  depth: number;
}

export type ReaderDisplayMode = "single" | "continuous";
export type ReaderZoomMode = "fit-width" | "manual";

interface ReaderPosition {
  page: number;
  zoom: number;
  displayMode: ReaderDisplayMode;
  zoomMode: ReaderZoomMode;
}

interface ReaderState {
  activeBookId: string | null;
  currentPage: number;
  zoom: number;
  displayMode: ReaderDisplayMode;
  zoomMode: ReaderZoomMode;
  navigationRequest: number;
  highlightedSourceId: string | null;
  outlineItems: ReaderOutlineItem[];
  setActiveBookId: (bookId: string | null) => void;
  setCurrentPage: (page: number) => void;
  setVisiblePage: (page: number) => void;
  setZoom: (zoom: number) => void;
  setFitWidthZoom: (zoom: number) => void;
  setDisplayMode: (mode: ReaderDisplayMode) => void;
  setOutlineItems: (items: ReaderOutlineItem[]) => void;
  openSource: (sourceId: string, page: number) => void;
  clearSourceHighlight: () => void;
}

const DEFAULT_ZOOM = 1.2;
const DEFAULT_DISPLAY_MODE: ReaderDisplayMode = "single";
const DEFAULT_ZOOM_MODE: ReaderZoomMode = "fit-width";
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 2.4;

/** Keep reader interaction state in Zustand and persist only per-book position/zoom in localStorage. */
export const useReaderStore = create<ReaderState>((set, get) => ({
  activeBookId: null,
  currentPage: 1,
  zoom: DEFAULT_ZOOM,
  displayMode: DEFAULT_DISPLAY_MODE,
  zoomMode: DEFAULT_ZOOM_MODE,
  navigationRequest: 0,
  highlightedSourceId: null,
  outlineItems: [],
  setActiveBookId: (activeBookId) => {
    const saved = activeBookId ? readPosition(activeBookId) : null;
    set({
      activeBookId,
      currentPage: saved?.page ?? 1,
      zoom: saved?.zoom ?? DEFAULT_ZOOM,
      displayMode: saved?.displayMode ?? DEFAULT_DISPLAY_MODE,
      zoomMode: saved?.zoomMode ?? DEFAULT_ZOOM_MODE,
      navigationRequest: get().navigationRequest + 1,
      highlightedSourceId: null,
      outlineItems: [],
    });
  },
  setCurrentPage: (currentPage) => {
    const page = Math.max(1, Math.floor(currentPage));
    set((state) => ({
      currentPage: page,
      navigationRequest: state.navigationRequest + 1,
      highlightedSourceId: null,
    }));
    persistCurrentPosition(get(), page);
  },
  setVisiblePage: (currentPage) => {
    const page = Math.max(1, Math.floor(currentPage));
    if (get().currentPage === page) return;
    set({ currentPage: page });
    persistCurrentPosition(get(), page);
  },
  setZoom: (zoom) => {
    const bounded = boundZoom(zoom);
    set({ zoom: bounded, zoomMode: "manual" });
    persistCurrentPosition(get(), get().currentPage, bounded, undefined, "manual");
  },
  setFitWidthZoom: (zoom) => {
    const bounded = boundZoom(zoom);
    set({ zoom: bounded, zoomMode: "fit-width" });
    persistCurrentPosition(get(), get().currentPage, bounded, undefined, "fit-width");
  },
  setDisplayMode: (displayMode) => {
    set({ displayMode });
    persistCurrentPosition(get(), get().currentPage, undefined, displayMode);
  },
  setOutlineItems: (outlineItems) => set({ outlineItems }),
  openSource: (highlightedSourceId, currentPage) => {
    const page = Math.max(1, Math.floor(currentPage));
    set((state) => ({
      highlightedSourceId,
      currentPage: page,
      navigationRequest: state.navigationRequest + 1,
    }));
    persistCurrentPosition(get(), page);
  },
  clearSourceHighlight: () => set({ highlightedSourceId: null }),
}));

function persistCurrentPosition(
  state: ReaderState,
  page: number,
  zoom = state.zoom,
  displayMode = state.displayMode,
  zoomMode = state.zoomMode,
): void {
  if (!state.activeBookId || typeof window === "undefined") return;
  const value: ReaderPosition = { page, zoom, displayMode, zoomMode };
  window.localStorage.setItem(positionKey(state.activeBookId), JSON.stringify(value));
}

function readPosition(bookId: string): ReaderPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(positionKey(bookId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ReaderPosition>;
    if (!Number.isFinite(value.page) || !Number.isFinite(value.zoom)) return null;
    return {
      page: Math.max(1, Math.floor(value.page!)),
      zoom: boundZoom(value.zoom!),
      displayMode: value.displayMode === "continuous" ? "continuous" : DEFAULT_DISPLAY_MODE,
      zoomMode: value.zoomMode === "manual" ? "manual" : DEFAULT_ZOOM_MODE,
    };
  } catch {
    return null;
  }
}

function boundZoom(zoom: number): number {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
}

function positionKey(bookId: string): string {
  return `deep-reader:reader-position:${bookId}`;
}
