import { normalizePdfText, type PdfRect } from "@deep-reader/shared";
import type { PageViewport } from "pdfjs-dist";

export interface SelectionDraft {
  quoteRaw: string;
  quoteNormalized: string;
  prefix?: string;
  suffix?: string;
  rects: PdfRect[];
  popoverX: number;
  popoverY: number;
}

const CONTEXT_FINGERPRINT_CHARACTERS = 160;

/** Convert a DOM text selection inside one PDF text layer into PDF-coordinate rectangles and context fingerprints. */
export function capturePdfSelection(input: {
  selection: Selection | null;
  textLayer: HTMLElement;
  viewport: PageViewport;
  pageIndex: number;
}): SelectionDraft | null {
  const { selection, textLayer, viewport, pageIndex } = input;
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!textLayer.contains(range.commonAncestorContainer)) {
    return null;
  }

  const quoteRaw = selection.toString().trim();
  const quoteNormalized = normalizePdfText(quoteRaw);
  if (!quoteNormalized) {
    return null;
  }

  const layerBox = textLayer.getBoundingClientRect();
  const clientRects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0.5 && rect.height > 0.5,
  );
  if (clientRects.length === 0) {
    return null;
  }

  const rects = clientRects.map<PdfRect>((rect) => {
    const left = rect.left - layerBox.left;
    const top = rect.top - layerBox.top;
    const right = rect.right - layerBox.left;
    const bottom = rect.bottom - layerBox.top;
    const [pdfLeft, pdfTop] = viewport.convertToPdfPoint(left, top);
    const [pdfRight, pdfBottom] = viewport.convertToPdfPoint(right, bottom);

    return {
      pageIndex,
      x: Math.min(pdfLeft, pdfRight),
      y: Math.min(pdfTop, pdfBottom),
      width: Math.abs(pdfRight - pdfLeft),
      height: Math.abs(pdfBottom - pdfTop),
    };
  });

  const lastRect = clientRects.at(-1);
  if (!lastRect) {
    return null;
  }

  const prefixRange = document.createRange();
  prefixRange.selectNodeContents(textLayer);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  const prefix = normalizePdfText(prefixRange.toString()).slice(-CONTEXT_FINGERPRINT_CHARACTERS);

  const suffixRange = document.createRange();
  suffixRange.selectNodeContents(textLayer);
  suffixRange.setStart(range.endContainer, range.endOffset);
  const suffix = normalizePdfText(suffixRange.toString()).slice(0, CONTEXT_FINGERPRINT_CHARACTERS);

  return {
    quoteRaw,
    quoteNormalized,
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
    rects,
    popoverX: Math.min(Math.max(lastRect.right - layerBox.left, 24), layerBox.width - 24),
    popoverY: Math.min(Math.max(lastRect.bottom - layerBox.top + 8, 8), layerBox.height - 8),
  };
}


export interface PdfSelectionPageContext {
  pageIndex: number;
  textLayer: HTMLElement;
  viewport: PageViewport;
}

export interface MultiPageSelectionDraft extends SelectionDraft {
  pageStart: number;
  pageEnd: number;
  popoverPageIndex: number;
}

/** Capture one browser selection spanning multiple rendered PDF text layers. */
export function capturePdfSelectionAcrossPages(input: {
  selection: Selection | null;
  contexts: PdfSelectionPageContext[];
}): MultiPageSelectionDraft | null {
  const { selection, contexts } = input;
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const quoteRaw = selection.toString().trim();
  const quoteNormalized = normalizePdfText(quoteRaw);
  if (!quoteNormalized) return null;
  const range = selection.getRangeAt(0);
  const clientRects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5);
  if (clientRects.length === 0) return null;

  const mapped = clientRects.flatMap((rect) => {
    const context = contextForRect(rect, contexts);
    if (!context) return [];
    const box = context.textLayer.getBoundingClientRect();
    const [pdfLeft, pdfTop] = context.viewport.convertToPdfPoint(rect.left - box.left, rect.top - box.top);
    const [pdfRight, pdfBottom] = context.viewport.convertToPdfPoint(rect.right - box.left, rect.bottom - box.top);
    return [{
      context,
      clientRect: rect,
      pdfRect: {
        pageIndex: context.pageIndex,
        x: Math.min(pdfLeft, pdfRight),
        y: Math.min(pdfTop, pdfBottom),
        width: Math.abs(pdfRight - pdfLeft),
        height: Math.abs(pdfBottom - pdfTop),
      } satisfies PdfRect,
    }];
  });
  const pageIndexes = [...new Set(mapped.map((item) => item.context.pageIndex))].sort((a, b) => a - b);
  if (pageIndexes.length < 2) return null;
  const last = mapped.at(-1);
  if (!last) return null;
  const lastBox = last.context.textLayer.getBoundingClientRect();
  return {
    quoteRaw,
    quoteNormalized,
    rects: mapped.map((item) => item.pdfRect),
    popoverX: Math.min(Math.max(last.clientRect.right - lastBox.left, 24), lastBox.width - 24),
    popoverY: Math.min(Math.max(last.clientRect.bottom - lastBox.top + 8, 8), lastBox.height - 8),
    pageStart: pageIndexes[0]!,
    pageEnd: pageIndexes.at(-1)!,
    popoverPageIndex: last.context.pageIndex,
  };
}

function contextForRect(rect: DOMRect, contexts: PdfSelectionPageContext[]): PdfSelectionPageContext | undefined {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return contexts.find((context) => {
    const box = context.textLayer.getBoundingClientRect();
    return centerX >= box.left && centerX <= box.right && centerY >= box.top && centerY <= box.bottom;
  });
}
