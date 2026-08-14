import {
  bookSearchResponseSchema,
  documentIndexStatusSchema,
  normalizePdfText,
  resolveSelectionResponseSchema,
  type BookSearchResponse,
  type DocumentBlock,
  type DocumentIndexStatus,
  type ResolveSelectionResponse,
  type SelectionResolutionCandidate,
} from "@lensmap/shared";
import type { BookRepository } from "../books/book-repository.js";
import { DocumentRepository } from "./document-repository.js";
import { parsePdfForIndex } from "./pdf-indexer.js";

interface IndexRuntimeState {
  status: "indexing" | "error";
  error: string | null;
}

/** Coordinate lazy/background PDF indexing and lexical retrieval with one index job per book. */
export class DocumentIndexService {
  private readonly running = new Map<string, Promise<void>>();
  private readonly runtime = new Map<string, IndexRuntimeState>();

  public constructor(
    private readonly repository: DocumentRepository,
    private readonly bookRepository: BookRepository,
  ) {}

  public getStatus(bookId: string): DocumentIndexStatus {
    const book = this.bookRepository.findById(bookId);
    if (!book) throw new Error("Book not found");
    const runtime = this.runtime.get(bookId);
    const blockCount = this.repository.countBlocks(bookId);
    if (runtime?.status === "indexing") {
      return documentIndexStatusSchema.parse({
        bookId,
        status: "indexing",
        pageCount: book.pageCount,
        blockCount,
        indexedAt: book.indexedAt,
        error: null,
      });
    }
    if (runtime?.status === "error") {
      return documentIndexStatusSchema.parse({
        bookId,
        status: "error",
        pageCount: book.pageCount,
        blockCount,
        indexedAt: book.indexedAt,
        error: runtime.error,
      });
    }
    return documentIndexStatusSchema.parse({
      bookId,
      status: book.indexedAt && blockCount > 0 ? "indexed" : "not-indexed",
      pageCount: book.pageCount,
      blockCount,
      indexedAt: book.indexedAt,
      error: null,
    });
  }

  public startIndex(bookId: string, force = false): Promise<void> {
    const existingJob = this.running.get(bookId);
    if (existingJob) return existingJob;

    const book = this.bookRepository.findById(bookId);
    if (!book) return Promise.reject(new Error("Book not found"));
    if (!force && book.indexedAt && this.repository.countBlocks(bookId) > 0) return Promise.resolve();

    const job = this.indexBook(bookId)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "PDF indexing failed";
        this.runtime.set(bookId, { status: "error", error: message });
        throw error;
      })
      .finally(() => {
        this.running.delete(bookId);
      });
    this.running.set(bookId, job);
    return job;
  }

  public async ensureIndexed(bookId: string): Promise<void> {
    const status = this.getStatus(bookId);
    if (status.status === "indexed") return;
    await this.startIndex(bookId, status.status === "error");
  }

  public async searchBook(bookId: string, query: string, limit = 10): Promise<BookSearchResponse> {
    await this.ensureIndexed(bookId);
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return bookSearchResponseSchema.parse({ query: normalizedQuery, hits: [] });
    const boundedLimit = Math.min(Math.max(limit, 1), 50);
    const ftsQuery = buildFtsQuery(normalizedQuery);
    const lexicalRows = ftsQuery ? this.repository.search(bookId, ftsQuery, boundedLimit * 2) : [];
    const cjk = containsCjk(normalizedQuery);
    const compactQuery = normalizedQuery.replace(/\s+/gu, "");
    const trigramQuery = cjk && compactQuery.length >= 3
      ? buildTrigramQuery(normalizedQuery)
      : "";
    const trigramRows = trigramQuery
      ? this.repository.searchTrigram(bookId, trigramQuery, boundedLimit * 2)
      : [];
    const substringRows = cjk
      ? this.repository.searchSubstring(bookId, normalizedQuery, boundedLimit * 2)
      : [];
    const rows = mergeSearchRows(lexicalRows, trigramRows, substringRows).slice(0, boundedLimit);
    const blocks = new Map(
      this.repository.findBlocksByIds(rows.map((row) => row.blockId)).map((block) => [block.id, block]),
    );
    return bookSearchResponseSchema.parse({
      query: normalizedQuery,
      hits: rows.flatMap((row) => {
        const block = blocks.get(row.blockId);
        return block ? [{ block, rank: row.rank, snippet: row.snippet }] : [];
      }),
    });
  }


  public async getOutline(bookId: string) {
    await this.ensureIndexed(bookId);
    const embedded = this.repository.listOutline(bookId);
    if (embedded.length > 0) return { items: embedded };
    return {
      items: this.repository.listHeadings(bookId).map((block, order) => ({
        id: block.id,
        title: block.textNormalized,
        pageIndex: block.pageIndex,
        depth: 0,
        order,
      })),
    };
  }

  /** Match physical selection rectangles back to semantic blocks without depending on exact text extraction. */
  public async matchSelectionBlocks(bookId: string, rects: Array<{ pageIndex: number; x: number; y: number; width: number; height: number }>, quoteNormalized: string): Promise<string[]> {
    await this.ensureIndexed(bookId);
    const pageIndexes = [...new Set(rects.map((rect) => rect.pageIndex))].sort((a, b) => a - b);
    const matched: DocumentBlock[] = [];
    for (const pageIndex of pageIndexes) {
      const selectionRects = rects.filter((rect) => rect.pageIndex === pageIndex);
      const blocks = this.repository.listBlocksByPage(bookId, pageIndex);
      for (const block of blocks) {
        if (block.rects.some((blockRect) => selectionRects.some((selectionRect) => rectsOverlap(blockRect, selectionRect)))) {
          matched.push(block);
        }
      }
      if (matched.some((block) => block.pageIndex === pageIndex)) continue;
      const normalized = quoteNormalized.trim();
      matched.push(...blocks.filter((block) =>
        normalized.includes(block.textNormalized) || block.textNormalized.includes(normalized),
      ));
    }
    return [...new Set(matched
      .sort((a, b) => a.pageIndex - b.pageIndex || a.blockOrder - b.blockOrder)
      .map((block) => block.id))];
  }

  /** Resolve Chrome/native-viewer selection text back to PDF pages and semantic blocks. */
  public async resolveSelectionText(bookId: string, quoteRaw: string): Promise<ResolveSelectionResponse> {
    await this.ensureIndexed(bookId);
    const quoteNormalized = normalizePdfText(quoteRaw);
    if (!quoteNormalized) return resolveSelectionResponseSchema.parse({ quoteNormalized: "", candidates: [] });

    const exactPages = this.repository.findPagesContaining(bookId, quoteNormalized, 20);
    const compactQuote = compactSelectionText(quoteNormalized);
    const fallbackPages = exactPages.length === 0 && compactQuote.length >= 6
      ? this.repository.findPagesContainingCompact(bookId, compactQuote, 20)
      : [];
    const candidatePages = exactPages.length > 0 ? exactPages : fallbackPages;
    const candidates = candidatePages.map((page) =>
      this.buildSelectionCandidate(bookId, quoteRaw, quoteNormalized, page.pageIndex, page.pageIndex, "exact-page"),
    ).filter((candidate): candidate is SelectionResolutionCandidate => candidate !== null);

    if (candidates.length === 0 && quoteNormalized.length >= 12) {
      const needleLength = Math.min(96, Math.max(24, Math.floor(quoteNormalized.length / 3)));
      const startNeedle = quoteNormalized.slice(0, needleLength);
      const endNeedle = quoteNormalized.slice(-needleLength);
      const starts = this.repository.findPagesContaining(bookId, startNeedle, 20);
      const ends = this.repository.findPagesContaining(bookId, endNeedle, 20);
      const seen = new Set<string>();
      for (const start of starts) {
        for (const end of ends) {
          if (end.pageIndex < start.pageIndex || end.pageIndex - start.pageIndex > 12) continue;
          const key = `${start.pageIndex}:${end.pageIndex}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const candidate = this.buildSelectionCandidate(
            bookId, quoteRaw, quoteNormalized, start.pageIndex, end.pageIndex, "boundary-range",
          );
          if (candidate) candidates.push(candidate);
          if (candidates.length >= 10) break;
        }
        if (candidates.length >= 10) break;
      }
    }

    return resolveSelectionResponseSchema.parse({ quoteNormalized, candidates });
  }

  private buildSelectionCandidate(
    bookId: string,
    quoteRaw: string,
    quoteNormalized: string,
    pageStart: number,
    pageEnd: number,
    confidence: "exact-page" | "boundary-range",
  ): SelectionResolutionCandidate | null {
    const pages = Array.from({ length: pageEnd - pageStart + 1 }, (_, offset) =>
      this.repository.getPage(bookId, pageStart + offset),
    ).filter((page): page is NonNullable<typeof page> => Boolean(page));
    if (pages.length === 0) return null;

    const blocks = pages.flatMap((page) => this.repository.listBlocksByPage(bookId, page.pageIndex));
    let matched = blocks.filter((block) => selectionTextsOverlap(quoteNormalized, block.textNormalized));
    if (matched.length === 0 && confidence === "boundary-range") {
      const firstNeedle = quoteNormalized.slice(0, Math.min(96, quoteNormalized.length));
      const lastNeedle = quoteNormalized.slice(-Math.min(96, quoteNormalized.length));
      matched = blocks.filter((block) =>
        selectionTextsOverlap(firstNeedle, block.textNormalized) ||
        selectionTextsOverlap(lastNeedle, block.textNormalized),
      );
    }
    if (matched.length === 0) return null;

    const firstPage = pages[0]!;
    const lastPage = pages.at(-1)!;
    const firstNeedle = quoteNormalized.slice(0, Math.min(96, quoteNormalized.length));
    const lastNeedle = quoteNormalized.slice(-Math.min(96, quoteNormalized.length));
    const firstIndex = firstPage.textNormalized.indexOf(firstNeedle);
    const lastIndex = lastPage.textNormalized.lastIndexOf(lastNeedle);
    const prefix = firstIndex > 0 ? firstPage.textNormalized.slice(Math.max(0, firstIndex - 160), firstIndex) : "";
    const suffixStart = lastIndex >= 0 ? lastIndex + lastNeedle.length : -1;
    const suffix = suffixStart >= 0 ? lastPage.textNormalized.slice(suffixStart, suffixStart + 160) : "";

    return {
      pageStart,
      pageEnd,
      ...(firstPage.printedPageLabel ? { printedPageLabelStart: firstPage.printedPageLabel } : {}),
      ...(lastPage.printedPageLabel ? { printedPageLabelEnd: lastPage.printedPageLabel } : {}),
      quoteRaw,
      quoteNormalized,
      ...(prefix ? { prefix } : {}),
      ...(suffix ? { suffix } : {}),
      rects: matched.flatMap((block) => block.rects),
      documentNodeIds: matched.map((block) => block.id),
      confidence,
    };
  }

  public async getPage(bookId: string, pageIndex: number) {
    await this.ensureIndexed(bookId);
    const page = this.repository.getPage(bookId, pageIndex);
    if (!page) throw new Error(`Document page not found: ${pageIndex}`);
    return page;
  }

  public async getPageBlocks(bookId: string, pageIndex: number): Promise<DocumentBlock[]> {
    await this.ensureIndexed(bookId);
    return this.repository.listBlocksByPage(bookId, pageIndex);
  }

  public async getBlocksByIds(bookId: string, ids: string[]): Promise<DocumentBlock[]> {
    await this.ensureIndexed(bookId);
    const unique = [...new Set(ids)];
    const blocks = this.repository.findBlocksByIds(unique);
    const byId = new Map(blocks.map((block) => [block.id, block]));
    return unique.map((id) => {
      const block = byId.get(id);
      if (!block) throw new Error(`Document block not found: ${id}`);
      if (block.bookId !== bookId) throw new Error(`Document block belongs to another book: ${id}`);
      return block;
    });
  }

  private async indexBook(bookId: string): Promise<void> {
    const book = this.bookRepository.findById(bookId);
    if (!book) throw new Error("Book not found");
    this.runtime.set(bookId, { status: "indexing", error: null });
    const parsed = await parsePdfForIndex(bookId, book.managedPath);
    if (parsed.blocks.length === 0) {
      throw new Error("PDFから索引可能なテキストを抽出できませんでした。画像のみのPDF、または未対応の文字マッピングの可能性があります。");
    }
    this.repository.replaceBookIndex(bookId, parsed.pages, parsed.blocks, parsed.outline);
    this.bookRepository.updateIndexMetadata(bookId, parsed.pageCount, new Date().toISOString());
    this.runtime.delete(bookId);
  }
}

/** Quote user/AI terms as literal FTS tokens to avoid exposing SQLite query syntax. */
export function buildFtsQuery(query: string): string {
  const terms = query
    .normalize("NFKC")
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 12);
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND ");
}

/** Treat the complete trigram query as one literal phrase rather than exposing FTS syntax. */
export function buildTrigramQuery(query: string): string {
  const normalized = query.normalize("NFKC").trim();
  return normalized ? `"${normalized.replaceAll('"', '""')}"` : "";
}


function containsCjk(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
}

function mergeSearchRows<T extends { blockId: string }>(...groups: T[][]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const group of groups) {
    for (const row of group) {
      if (seen.has(row.blockId)) continue;
      seen.add(row.blockId);
      merged.push(row);
    }
  }
  return merged;
}


/** Remove normalized whitespace only for selection matching; displayed/indexed text remains unchanged. */
function compactSelectionText(value: string): string {
  return value.replace(/\s+/gu, "");
}

/** Compare exact normalized text first, then tolerate glyph-by-glyph spacing from PDF extraction. */
function selectionTextsOverlap(left: string, right: string): boolean {
  if (left.includes(right) || right.includes(left)) return true;
  const compactLeft = compactSelectionText(left);
  const compactRight = compactSelectionText(right);
  if (Math.min(compactLeft.length, compactRight.length) < 6) return false;
  return compactLeft.includes(compactRight) || compactRight.includes(compactLeft);
}

function rectsOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  const overlapWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const overlapHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  if (overlapWidth === 0 || overlapHeight === 0) return false;
  const overlap = overlapWidth * overlapHeight;
  const smaller = Math.min(left.width * left.height, right.width * right.height);
  return smaller > 0 && overlap / smaller >= 0.12;
}
