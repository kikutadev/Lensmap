import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { SourceAnchor } from "@deep-reader/shared";
import { TextLayer, type PDFDocumentProxy, type PageViewport, type RenderTask } from "pdfjs-dist";
import { capturePdfSelection, type SelectionDraft } from "./selection";

interface ViewportRect { left: number; top: number; width: number; height: number; }

interface PdfPageViewProps {
  pdf: PDFDocumentProxy;
  pageIndex: number;
  zoom: number;
  highlightedSource: SourceAnchor | undefined;
  selectionDraft: SelectionDraft | null;
  onSelection: (draft: SelectionDraft | null) => void;
  onSaveSelection: (mode: "attach" | "deep-dive") => void;
  isSaving: boolean;
  onContextReady?: (pageIndex: number, textLayer: HTMLElement | null, viewport: PageViewport | null) => void;
  scrollRootRef: RefObject<HTMLDivElement | null>;
}

/** Lazily render one page when it approaches the viewport while keeping a stable scroll placeholder. */
export function PdfPageView({
  pdf,
  pageIndex,
  zoom,
  highlightedSource,
  selectionDraft,
  onSelection,
  onSaveSelection,
  isSaving,
  onContextReady,
  scrollRootRef,
}: PdfPageViewProps) {
  const pageLayerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerElementRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const textLayerRef = useRef<TextLayer | null>(null);
  const [shouldRender, setShouldRender] = useState(pageIndex < 2);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [baseSize, setBaseSize] = useState({ width: 612, height: 792 });
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    const element = pageLayerRef.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      const nearViewport = entries.some((entry) => entry.isIntersecting);
      setShouldRender(nearViewport);
    }, { root: scrollRootRef.current, rootMargin: "1400px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRootRef]);

  useEffect(() => {
    if (!shouldRender) return;
    const canvas = canvasRef.current;
    const pageLayer = pageLayerRef.current;
    const textLayerElement = textLayerElementRef.current;
    if (!canvas || !pageLayer || !textLayerElement) return;
    let cancelled = false;
    setRenderError(null);
    textLayerRef.current?.cancel();
    renderTaskRef.current?.cancel();
    textLayerElement.replaceChildren();

    void pdf.getPage(pageIndex + 1).then(async (page) => {
      if (cancelled) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const nextViewport = page.getViewport({ scale: zoom });
      setBaseSize({ width: baseViewport.width, height: baseViewport.height });
      setViewport(nextViewport);
      pageLayer.style.width = `${Math.floor(nextViewport.width)}px`;
      pageLayer.style.height = `${Math.floor(nextViewport.height)}px`;
      pageLayer.style.setProperty("--total-scale-factor", String(nextViewport.scale));
      pageLayer.style.setProperty("--scale-round-x", "1px");
      pageLayer.style.setProperty("--scale-round-y", "1px");

      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D context is unavailable");
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(nextViewport.width * outputScale);
      canvas.height = Math.floor(nextViewport.height * outputScale);
      canvas.style.width = `${Math.floor(nextViewport.width)}px`;
      canvas.style.height = `${Math.floor(nextViewport.height)}px`;
      const renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport: nextViewport,
        ...(outputScale === 1 ? {} : { transform: [outputScale, 0, 0, outputScale, 0, 0] }),
      });
      renderTaskRef.current = renderTask;
      const textContent = await page.getTextContent();
      if (cancelled) return;
      const textLayer = new TextLayer({ textContentSource: textContent, container: textLayerElement, viewport: nextViewport });
      textLayerRef.current = textLayer;
      await Promise.all([renderTask.promise, textLayer.render()]);
      if (!cancelled) onContextReady?.(pageIndex, textLayerElement, nextViewport);
    }).catch((reason: unknown) => {
      const name = reason instanceof Error ? reason.name : "";
      if (!cancelled && name !== "RenderingCancelledException" && name !== "AbortException") {
        setRenderError(reason instanceof Error ? reason.message : "ページ描画に失敗しました");
      }
    });

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      textLayerRef.current?.cancel();
      renderTaskRef.current = null;
      textLayerRef.current = null;
      textLayerElementRef.current?.replaceChildren();
      onContextReady?.(pageIndex, null, null);
    };
  }, [onContextReady, pageIndex, pdf, shouldRender, zoom]);

  const highlightRects = useMemo<ViewportRect[]>(() => {
    if (!highlightedSource || !viewport) return [];
    return highlightedSource.rects.filter((rect) => rect.pageIndex === pageIndex).map((rect) => {
      const [x1, y1] = viewport.convertToViewportPoint(rect.x, rect.y);
      const [x2, y2] = viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height);
      return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    });
  }, [highlightedSource, pageIndex, viewport]);

  const captureSelection = () => {
    const textLayer = textLayerElementRef.current;
    if (!textLayer || !viewport) return;
    onSelection(capturePdfSelection({ selection: window.getSelection(), textLayer, viewport, pageIndex }));
  };

  return <div
    ref={pageLayerRef}
    data-pdf-page={pageIndex + 1}
    className="relative shrink-0 bg-white shadow-xl shadow-slate-400/25"
    style={{ width: Math.round(baseSize.width * zoom), height: Math.round(baseSize.height * zoom), scrollMarginTop: 16 }}
    onMouseUp={captureSelection}
  >
    {shouldRender ? <canvas ref={canvasRef} className="absolute inset-0" /> : <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-300">PDF {pageIndex + 1}</div>}
    <div ref={textLayerElementRef} className="textLayer" />
    {renderError ? <div className="absolute inset-x-4 top-4 rounded bg-red-50 p-2 text-xs text-red-700">{renderError}</div> : null}
    {shouldRender ? highlightRects.map((rect, index) => <div key={`${highlightedSource?.id ?? "source"}-${index}`} className="pointer-events-none absolute z-10 rounded-sm bg-amber-300/35 ring-1 ring-amber-500/30" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />) : null}
    {selectionDraft ? <div className="absolute z-30 flex -translate-x-1/2 gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-xl" style={{ left: selectionDraft.popoverX, top: selectionDraft.popoverY }} onMouseDown={(event) => event.preventDefault()}>
      <button className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50" disabled={isSaving} onClick={() => onSaveSelection("attach")}>引用に追加</button>
      <button className="whitespace-nowrap rounded-md bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50" disabled={isSaving} onClick={() => onSaveSelection("deep-dive")}>深掘り</button>
    </div> : null}
  </div>;
}
