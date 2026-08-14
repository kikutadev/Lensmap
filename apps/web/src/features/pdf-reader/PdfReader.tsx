import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, LoaderCircle, Minus, Plus, ScanLine } from "lucide-react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createSourceAnchor, fetchSourceAnchors, getBookPdfUrl } from "../../lib/api";
import { useReaderStore } from "../../store/reader-store";
import { useSourceDraftStore } from "../../store/source-draft-store";
import { PdfPageView } from "./PdfPageView";
import { resolvePdfOutline } from "./pdf-outline";
import { capturePdfSelectionAcrossPages, type PdfSelectionPageContext, type SelectionDraft } from "./selection";

GlobalWorkerOptions.workerSrc = workerUrl;
interface PdfReaderProps { bookId: string; }
interface PageSelectionDraft extends SelectionDraft { pageStart: number; pageEnd: number; popoverPageIndex: number; }

/** Continuous PDF reader with lazy page rendering, zoom, outline and source capture. */
export function PdfReader({ bookId }: PdfReaderProps) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectionContextsRef = useRef(new Map<number, PdfSelectionPageContext>());
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageLabels, setPageLabels] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<PageSelectionDraft | null>(null);
  const currentPage = useReaderStore((s) => s.currentPage);
  const zoom = useReaderStore((s) => s.zoom);
  const displayMode = useReaderStore((s) => s.displayMode);
  const zoomMode = useReaderStore((s) => s.zoomMode);
  const navigationRequest = useReaderStore((s) => s.navigationRequest);
  const setCurrentPage = useReaderStore((s) => s.setCurrentPage);
  const setVisiblePage = useReaderStore((s) => s.setVisiblePage);
  const setZoom = useReaderStore((s) => s.setZoom);
  const setFitWidthZoom = useReaderStore((s) => s.setFitWidthZoom);
  const setDisplayMode = useReaderStore((s) => s.setDisplayMode);
  const setOutlineItems = useReaderStore((s) => s.setOutlineItems);
  const highlightedSourceId = useReaderStore((s) => s.highlightedSourceId);
  const attachSource = useSourceDraftStore((s) => s.attachSource);
  const requestComposerFocus = useSourceDraftStore((s) => s.requestComposerFocus);
  const savedSources = useQuery({ queryKey: ["source-anchors", bookId], queryFn: ({ signal }) => fetchSourceAnchors(bookId, signal) });
  const highlightedSource = savedSources.data?.find((source) => source.id === highlightedSourceId);

  const saveSelection = useMutation({
    mutationFn: async (mode: "attach" | "deep-dive") => {
      if (!selectionDraft) throw new Error("保存する選択範囲がありません");
      const { pageStart, pageEnd } = selectionDraft;
      const startLabel = pageLabels?.[pageStart];
      const endLabel = pageLabels?.[pageEnd];
      const source = await createSourceAnchor(bookId, {
        pageStart, pageEnd,
        ...(startLabel ? { printedPageLabelStart: startLabel } : {}),
        ...(endLabel ? { printedPageLabelEnd: endLabel } : {}),
        quoteRaw: selectionDraft.quoteRaw, quoteNormalized: selectionDraft.quoteNormalized,
        ...(selectionDraft.prefix ? { prefix: selectionDraft.prefix } : {}),
        ...(selectionDraft.suffix ? { suffix: selectionDraft.suffix } : {}),
        rects: selectionDraft.rects, origin: "user-selection", documentNodeIds: [],
      });
      return { source, mode };
    },
    onSuccess: async ({ source, mode }) => {
      attachSource(source); setSelectionDraft(null); window.getSelection()?.removeAllRanges();
      await queryClient.invalidateQueries({ queryKey: ["source-anchors", bookId] });
      if (mode === "deep-dive") requestComposerFocus();
    },
  });

  const registerSelectionContext = useCallback((pageIndex: number, textLayer: HTMLElement | null, viewport: import("pdfjs-dist").PageViewport | null) => {
    if (!textLayer || !viewport) selectionContextsRef.current.delete(pageIndex);
    else selectionContextsRef.current.set(pageIndex, { pageIndex, textLayer, viewport });
  }, []);

  const captureMultiPageSelection = () => {
    if (displayMode !== "continuous") return;
    const draft = capturePdfSelectionAcrossPages({
      selection: window.getSelection(),
      contexts: [...selectionContextsRef.current.values()],
    });
    if (draft) setSelectionDraft(draft);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setPdf(null); setPageCount(0); setSelectionDraft(null); setOutlineItems([]); selectionContextsRef.current.clear();
    const task = getDocument({ url: getBookPdfUrl(bookId) });
    void task.promise.then(async (loaded) => {
      const [labels, outline] = await Promise.all([loaded.getPageLabels().catch(() => null), resolvePdfOutline(loaded).catch(() => [])]);
      if (cancelled) return;
      setPdf(loaded); setPageCount(loaded.numPages); setPageLabels(labels); setOutlineItems(outline);
      const restoredPage = useReaderStore.getState().currentPage;
      if (restoredPage > loaded.numPages) setCurrentPage(loaded.numPages);
      setLoading(false);
    }).catch((reason: unknown) => { if (!cancelled) { setError(reason instanceof Error ? reason.message : "PDFの読み込みに失敗しました"); setLoading(false); } });
    return () => { cancelled = true; setOutlineItems([]); void task.destroy(); };
  }, [bookId, setCurrentPage, setOutlineItems]);

  useEffect(() => {
    if (displayMode !== "continuous") return;
    const root = scrollRef.current;
    if (!root || pageCount === 0) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const page = visible ? Number((visible.target as HTMLElement).dataset.pdfPage) : NaN;
      if (Number.isInteger(page) && page > 0) setVisiblePage(page);
    }, { root, threshold: [0.2, 0.45, 0.7] });
    root.querySelectorAll<HTMLElement>("[data-pdf-page]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [displayMode, pageCount, setVisiblePage]);

  useEffect(() => {
    if (!pageCount) return;
    scrollRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${currentPage}"]`)?.scrollIntoView({ block: "start", behavior: highlightedSourceId ? "smooth" : "auto" });
  }, [navigationRequest, pageCount, highlightedSourceId, currentPage]);

  const fitWidth = useCallback(async () => {
    if (!pdf || !scrollRef.current) return;
    const page = await pdf.getPage(Math.min(Math.max(currentPage, 1), pdf.numPages));
    const availableWidth = Math.max(240, scrollRef.current.clientWidth - 56);
    setFitWidthZoom(availableWidth / page.getViewport({ scale: 1 }).width);
  }, [currentPage, pdf, setFitWidthZoom]);

  useEffect(() => {
    if (zoomMode !== "fit-width" || !pdf) return;
    const root = scrollRef.current;
    if (!root) return;
    void fitWidth();
    const observer = new ResizeObserver(() => { void fitWidth(); });
    observer.observe(root);
    return () => observer.disconnect();
  }, [fitWidth, pdf, zoomMode]);

  const changeDisplayMode = (mode: "single" | "continuous") => {
    if (mode === displayMode) return;
    setSelectionDraft(null);
    window.getSelection()?.removeAllRanges();
    setDisplayMode(mode);
  };

  if (loading) return <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18} />PDFを読み込み中…</div>;
  if (error || !pdf) return <div className="m-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error ?? "PDFを開けませんでした"}</div>;
  const printed = pageLabels?.[currentPage - 1];
  const pageDisplay = printed && printed !== String(currentPage) ? `${printed} · PDF ${currentPage}` : String(currentPage);

  return <div className="flex h-full min-h-0 flex-col">
    <div className="z-30 flex h-11 shrink-0 items-center justify-center gap-2 border-b border-slate-200 bg-white/95 text-xs backdrop-blur">
      <button className="rounded-md border border-slate-200 p-1 disabled:opacity-30" disabled={currentPage <= 1} onClick={() => setCurrentPage(currentPage - 1)} aria-label="前のページ"><ChevronLeft size={16} /></button>
      <span className="min-w-20 text-center tabular-nums">{pageDisplay} / {pageCount}</span>
      <button className="rounded-md border border-slate-200 p-1 disabled:opacity-30" disabled={currentPage >= pageCount} onClick={() => setCurrentPage(currentPage + 1)} aria-label="次のページ"><ChevronRight size={16} /></button>
      <span className="mx-1 h-5 border-l border-slate-200" />
      <button className="rounded-md border border-slate-200 p-1" onClick={() => setZoom(zoom - 0.1)} aria-label="縮小"><Minus size={15} /></button>
      <span className="min-w-12 text-center tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span>
      <button className="rounded-md border border-slate-200 p-1" onClick={() => setZoom(zoom + 0.1)} aria-label="拡大"><Plus size={15} /></button>
      <button
        className={`ml-1 flex items-center gap-1 rounded-md border px-2 py-1 ${zoomMode === "fit-width" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
        onClick={() => void fitWidth()}
        aria-label="幅に合わせる"
        aria-pressed={zoomMode === "fit-width"}
      ><ScanLine size={14} />幅に合わせる</button>
      <span className="mx-1 h-5 border-l border-slate-200" />
      <div className="flex rounded-md border border-slate-200 bg-white p-0.5" aria-label="ページ表示モード">
        <button
          className={`rounded px-2 py-0.5 ${displayMode === "single" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          onClick={() => changeDisplayMode("single")}
          aria-label="1ページ表示"
          aria-pressed={displayMode === "single"}
        >1ページ</button>
        <button
          className={`rounded px-2 py-0.5 ${displayMode === "continuous" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          onClick={() => changeDisplayMode("continuous")}
          aria-label="連続表示"
          aria-pressed={displayMode === "continuous"}
        >連続</button>
      </div>
    </div>
    <div ref={scrollRef} data-reader-scroll className="min-h-0 flex-1 overflow-auto bg-slate-200/70 px-7 py-7" onMouseUp={captureMultiPageSelection}>
      <div className="mx-auto flex w-max min-w-full flex-col items-center gap-5">
        {(displayMode === "single" ? [currentPage - 1] : Array.from({ length: pageCount }, (_, pageIndex) => pageIndex)).map((pageIndex) => (
          <PdfPageView
            key={pageIndex}
            pdf={pdf}
            pageIndex={pageIndex}
            zoom={zoom}
            highlightedSource={highlightedSource}
            selectionDraft={selectionDraft?.popoverPageIndex === pageIndex ? selectionDraft : null}
            onSelection={(draft) => setSelectionDraft(draft ? { ...draft, pageStart: pageIndex, pageEnd: pageIndex, popoverPageIndex: pageIndex } : null)}
            onSaveSelection={(mode) => saveSelection.mutate(mode)}
            isSaving={saveSelection.isPending}
            onContextReady={registerSelectionContext}
            scrollRootRef={scrollRef}
          />
        ))}
      </div>
    </div>
  </div>;
}
