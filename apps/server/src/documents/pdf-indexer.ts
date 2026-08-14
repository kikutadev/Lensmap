import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { normalizePdfText, type DocumentBlockKind, type DocumentOutlineItem, type PdfRect } from "@deep-reader/shared";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { IndexedBlockInput, IndexedPageInput } from "./document-repository.js";

interface PdfTextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

interface TextSpan {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  hasEOL: boolean;
}

interface TextLine {
  text: string;
  spans: TextSpan[];
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

interface ParsedBlock {
  kind: DocumentBlockKind;
  textRaw: string;
  textNormalized: string;
  rects: PdfRect[];
}

const PDFJS_DIST_ROOT = dirname(dirname(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.mjs"))));

export interface ParsedPdfIndex {
  pageCount: number;
  pages: IndexedPageInput[];
  blocks: IndexedBlockInput[];
  outline: DocumentOutlineItem[];
}

/**
 * Extract a conservative semantic layer from a text PDF.
 * The index never replaces physical PDF coordinates; uncertain layout falls back to paragraph-like blocks.
 */
export async function parsePdfForIndex(bookId: string, pdfPath: string): Promise<ParsedPdfIndex> {
  const bytes = await readFile(pdfPath);
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    cMapUrl: `${resolve(PDFJS_DIST_ROOT, "cmaps")}/`,
    cMapPacked: true,
    standardFontDataUrl: `${resolve(PDFJS_DIST_ROOT, "standard_fonts")}/`,
    wasmUrl: `${resolve(PDFJS_DIST_ROOT, "wasm")}/`,
  });

  try {
    const pdf = await loadingTask.promise;
    const pageLabels = await pdf.getPageLabels().catch(() => null);
    const outline = await extractOutline(pdf, bookId).catch(() => []);
    const createdAt = new Date().toISOString();
    const extracted: Array<{ pageIndex: number; pageHeight: number; printedPageLabel: string | null; lines: TextLine[] }> = [];

    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ disableNormalization: false });
      const items = content.items.flatMap((item) => isTextItem(item) ? [toSpan(item)] : []);
      extracted.push({
        pageIndex,
        pageHeight: viewport.height,
        printedPageLabel: pageLabels?.[pageIndex] ?? null,
        lines: buildLines(items, viewport.width),
      });
      page.cleanup();
    }

    const repeatedMarginText = identifyRepeatedMarginText(extracted);
    const pages: IndexedPageInput[] = [];
    const blocks: IndexedBlockInput[] = [];
    for (const page of extracted) {
      const lines = page.lines.filter((line) => !isDecorativeMarginLine(line, page.pageHeight, repeatedMarginText));
      const parsedBlocks = buildBlocks(lines, page.pageIndex);
      const textRaw = lines.map((line) => line.text).join("\n").trim();
      const textNormalized = normalizePdfText(textRaw);
      pages.push({
        id: stableId("page", bookId, String(page.pageIndex)),
        bookId,
        pageIndex: page.pageIndex,
        printedPageLabel: page.printedPageLabel,
        textRaw,
        textNormalized,
        createdAt,
      });
      parsedBlocks.forEach((block, blockOrder) => blocks.push({
        id: stableId("block", bookId, String(page.pageIndex), String(blockOrder), block.textNormalized),
        bookId,
        pageIndex: page.pageIndex,
        blockOrder,
        kind: block.kind,
        textRaw: block.textRaw,
        textNormalized: block.textNormalized,
        rects: block.rects,
        createdAt,
      }));
    }
    return { pageCount: pdf.numPages, pages, blocks, outline };
  } finally {
    await loadingTask.destroy();
  }
}

async function extractOutline(pdf: PDFDocumentProxy, bookId: string): Promise<DocumentOutlineItem[]> {
  const raw = await pdf.getOutline();
  if (!raw?.length) return [];
  const items: DocumentOutlineItem[] = [];
  let order = 0;
  const visit = async (nodes: typeof raw, depth: number): Promise<void> => {
    for (const node of nodes) {
      let destination: unknown = node.dest;
      if (typeof destination === "string") destination = await pdf.getDestination(destination);
      let pageIndex: number | null = null;
      if (Array.isArray(destination) && destination[0]) {
        pageIndex = await pdf.getPageIndex(destination[0]).catch(() => null);
      }
      if (pageIndex !== null) {
        const title = normalizePdfText(node.title || `PDF ${pageIndex + 1}`);
        if (title) {
          items.push({
            id: stableId("outline", bookId, String(order), title, String(pageIndex)),
            title,
            pageIndex,
            depth,
            order: order++,
          });
        }
      }
      if (node.items?.length) await visit(node.items, depth + 1);
    }
  };
  await visit(raw, 0);
  return items;
}

function isTextItem(value: unknown): value is PdfTextItemLike {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PdfTextItemLike>;
  return typeof item.str === "string"
    && Array.isArray(item.transform)
    && item.transform.length >= 6
    && typeof item.width === "number"
    && typeof item.height === "number"
    && typeof item.fontName === "string"
    && typeof item.hasEOL === "boolean";
}

function toSpan(item: PdfTextItemLike): TextSpan {
  const x = item.transform[4] ?? 0;
  const y = item.transform[5] ?? 0;
  const fontSize = Math.max(
    Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0),
    item.height,
    1,
  );
  return {
    text: item.str,
    x,
    y,
    width: Math.max(item.width, 0),
    height: Math.max(item.height || fontSize, 1),
    fontSize,
    fontName: item.fontName,
    hasEOL: item.hasEOL,
  };
}

function buildLines(spans: TextSpan[], pageWidth: number): TextLine[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => Math.abs(b.y - a.y) > 1 ? b.y - a.y : a.x - b.x);
  const baselineGroups: TextSpan[][] = [];
  for (const span of sorted) {
    const group = baselineGroups.at(-1);
    if (!group) { baselineGroups.push([span]); continue; }
    const tolerance = Math.max(2, median(group.map((item) => item.height)) * 0.55);
    if (Math.abs(span.y - median(group.map((item) => item.y))) <= tolerance) group.push(span);
    else baselineGroups.push([span]);
  }

  const lines = baselineGroups.flatMap((group) => {
    const ordered = [...group].sort((a, b) => a.x - b.x);
    const segments: TextSpan[][] = [];
    let current: TextSpan[] = [];
    for (const span of ordered) {
      const previous = current.at(-1);
      const gap = previous ? span.x - (previous.x + previous.width) : 0;
      const splitThreshold = Math.max(pageWidth * 0.08, median(ordered.map((item) => item.fontSize)) * 4.5);
      if (previous && gap > splitThreshold) { segments.push(current); current = []; }
      current.push(span);
    }
    if (current.length) segments.push(current);
    return segments.flatMap((segment) => {
      const text = joinSpans(segment).trimEnd();
      if (!text.trim()) return [];
      const x = Math.min(...segment.map((item) => item.x));
      const right = Math.max(...segment.map((item) => item.x + item.width));
      return [{
        text,
        spans: segment,
        x,
        y: median(segment.map((item) => item.y)),
        width: Math.max(0, right - x),
        height: median(segment.map((item) => item.height).filter((height) => height > 0)) || 1,
        fontSize: median(segment.map((item) => item.fontSize).filter((size) => size > 0)) || 1,
      } satisfies TextLine];
    });
  });
  return orderLinesForReading(lines, pageWidth);
}

function orderLinesForReading(lines: TextLine[], pageWidth: number): TextLine[] {
  const byVisualPosition = (a: TextLine, b: TextLine) => Math.abs(b.y - a.y) > 1 ? b.y - a.y : a.x - b.x;
  const narrow = lines.filter((line) => line.width < pageWidth * 0.68);
  const left = narrow.filter((line) => line.x + line.width / 2 < pageWidth * 0.48);
  const right = narrow.filter((line) => line.x + line.width / 2 > pageWidth * 0.52);
  if (left.length < 2 || right.length < 2) return [...lines].sort(byVisualPosition);

  const columnTop = Math.max(...left.map((line) => line.y), ...right.map((line) => line.y));
  const columnBottom = Math.min(...left.map((line) => line.y), ...right.map((line) => line.y));
  const wide = lines.filter((line) => !narrow.includes(line));
  const topWide = wide.filter((line) => line.y >= columnTop).sort(byVisualPosition);
  const bottomWide = wide.filter((line) => line.y <= columnBottom).sort(byVisualPosition);
  const middleWide = wide.filter((line) => !topWide.includes(line) && !bottomWide.includes(line)).sort(byVisualPosition);
  const columnSet = new Set([...left, ...right]);
  const other = narrow.filter((line) => !columnSet.has(line)).sort(byVisualPosition);
  return [...topWide, ...left.sort(byVisualPosition), ...right.sort(byVisualPosition), ...middleWide, ...other, ...bottomWide];
}

function joinSpans(spans: TextSpan[]): string {
  let result = "";
  let previous: TextSpan | undefined;
  for (const span of spans) {
    if (previous && needsSpace(previous, span)) result += " ";
    result += span.text;
    previous = span;
  }
  return result;
}

function needsSpace(previous: TextSpan, current: TextSpan): boolean {
  if (!previous.text || !current.text) return false;
  if (/\s$/u.test(previous.text) || /^\s/u.test(current.text)) return false;
  const gap = current.x - (previous.x + previous.width);
  if (gap <= Math.max(previous.fontSize, current.fontSize) * 0.12) return false;
  if (endsWithCjk(previous.text) || startsWithCjk(current.text)) return false;
  return true;
}


function identifyRepeatedMarginText(pages: Array<{ pageHeight: number; lines: TextLine[] }>): Set<string> {
  const occurrences = new Map<string, Set<number>>();
  pages.forEach((page, pageIndex) => {
    for (const line of page.lines) {
      if (!isMarginLine(line, page.pageHeight)) continue;
      const normalized = normalizePdfText(line.text);
      if (!normalized || normalized.length > 160) continue;
      const pagesForText = occurrences.get(normalized) ?? new Set<number>();
      pagesForText.add(pageIndex);
      occurrences.set(normalized, pagesForText);
    }
  });
  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  return new Set([...occurrences.entries()].filter(([, seen]) => seen.size >= threshold).map(([text]) => text));
}

function isDecorativeMarginLine(line: TextLine, pageHeight: number, repeated: Set<string>): boolean {
  if (!isMarginLine(line, pageHeight)) return false;
  const normalized = normalizePdfText(line.text);
  return repeated.has(normalized) || /^(?:\d+|[ivxlcdm]+)$/iu.test(normalized);
}

function isMarginLine(line: TextLine, pageHeight: number): boolean {
  return line.y >= pageHeight * 0.9 || line.y <= pageHeight * 0.1;
}
function buildBlocks(lines: TextLine[], pageIndex: number): ParsedBlock[] {
  if (lines.length === 0) return [];
  const pageFontSize = median(lines.map((line) => line.fontSize)) || 1;
  const lineHeight = median(lines.map((line) => line.height)) || pageFontSize;
  const blocks: TextLine[][] = [];
  let current: TextLine[] = [];

  const flush = () => {
    if (current.length > 0) blocks.push(current);
    current = [];
  };

  for (const line of lines) {
    const previous = current.at(-1);
    if (previous) {
      const verticalGap = Math.abs(previous.y - line.y);
      const previousHeading = isHeadingLine(previous, pageFontSize);
      const currentHeading = isHeadingLine(line, pageFontSize);
      const shouldBreak = previousHeading
        || currentHeading
        || verticalGap > Math.max(lineHeight * 1.75, previous.height * 1.55);
      if (shouldBreak) flush();
    }
    current.push(line);
  }
  flush();

  return blocks.flatMap((blockLines) => {
    const textRaw = blockLines.map((line) => line.text).join("\n").trim();
    const textNormalized = normalizePdfText(textRaw);
    if (!textNormalized) return [];
    return [{
      kind: classifyBlock(blockLines, pageFontSize),
      textRaw,
      textNormalized,
      rects: blockLines.flatMap((line) => line.spans.map((span) => spanToRect(span, pageIndex))),
    } satisfies ParsedBlock];
  });
}

function classifyBlock(lines: TextLine[], pageFontSize: number): DocumentBlockKind {
  const firstLine = lines[0];
  if (lines.length === 1 && firstLine && isHeadingLine(firstLine, pageFontSize)) return "heading";
  const allSpans = lines.flatMap((line) => line.spans);
  const monoRatio = allSpans.length === 0
    ? 0
    : allSpans.filter((span) => /mono|courier|code/i.test(span.fontName)).length / allSpans.length;
  if (monoRatio >= 0.6) return "code";
  const tableSignals = lines.filter((line) => /\s{2,}|\t|\|/.test(line.text)).length;
  if (lines.length >= 2 && tableSignals / lines.length >= 0.65) return "table-like";
  return "paragraph";
}

function isHeadingLine(line: TextLine, pageFontSize: number): boolean {
  const normalized = normalizePdfText(line.text);
  if (!normalized || normalized.length > 160) return false;
  return line.fontSize >= pageFontSize * 1.22;
}

function spanToRect(span: TextSpan, pageIndex: number): PdfRect {
  return {
    pageIndex,
    x: span.x,
    y: span.y - span.height * 0.2,
    width: span.width,
    height: span.height,
  };
}

function stableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function startsWithCjk(text: string): boolean {
  return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
}

function endsWithCjk(text: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(text);
}
