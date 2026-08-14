import { and, asc, eq } from "drizzle-orm";
import type Database from "better-sqlite3";
import type { DocumentOutlineItem } from "@lensmap/shared";
import {
  documentBlockSchema,
  documentPageSchema,
  type DocumentBlock,
  type DocumentBlockKind,
  type DocumentPage,
  type PdfRect,
} from "@lensmap/shared";
import type { AppDatabase } from "../persistence/database.js";
import { documentBlocks, documentOutlineItems, documentPages } from "../persistence/schema.js";

export interface IndexedPageInput {
  id: string;
  bookId: string;
  pageIndex: number;
  printedPageLabel: string | null;
  textRaw: string;
  textNormalized: string;
  createdAt: string;
}

export interface IndexedBlockInput {
  id: string;
  bookId: string;
  pageIndex: number;
  blockOrder: number;
  kind: DocumentBlockKind;
  textRaw: string;
  textNormalized: string;
  rects: PdfRect[];
  createdAt: string;
}

export interface DocumentSearchRow {
  blockId: string;
  rank: number;
  snippet: string;
}

/** Store structured PDF text and keep the FTS5 retrieval index in sync. */
export class DocumentRepository {
  public constructor(
    private readonly db: AppDatabase,
    private readonly sqlite: Database.Database,
  ) {}

  public replaceBookIndex(bookId: string, pages: IndexedPageInput[], blocks: IndexedBlockInput[], outline: DocumentOutlineItem[] = []): void {
    const replace = this.sqlite.transaction(() => {
      this.db.delete(documentBlocks).where(eq(documentBlocks.bookId, bookId)).run();
      this.db.delete(documentOutlineItems).where(eq(documentOutlineItems.bookId, bookId)).run();
      this.db.delete(documentPages).where(eq(documentPages.bookId, bookId)).run();
      this.sqlite.prepare("DELETE FROM document_blocks_fts WHERE book_id = ?").run(bookId);
      this.sqlite.prepare("DELETE FROM document_blocks_trigram WHERE book_id = ?").run(bookId);

      for (const batch of chunks(pages, 80)) {
        this.db.insert(documentPages).values(batch).run();
      }
      const outlineRows = outline.map((item) => ({
        id: item.id,
        bookId,
        itemOrder: item.order,
        title: item.title,
        pageIndex: item.pageIndex,
        depth: item.depth,
      }));
      for (const batch of chunks(outlineRows, 80)) {
        this.db.insert(documentOutlineItems).values(batch).run();
      }
      if (blocks.length > 0) {
        const blockRows = blocks.map((block) => ({
          id: block.id,
          bookId: block.bookId,
          pageIndex: block.pageIndex,
          blockOrder: block.blockOrder,
          kind: block.kind,
          textRaw: block.textRaw,
          textNormalized: block.textNormalized,
          rectsJson: JSON.stringify(block.rects),
          createdAt: block.createdAt,
        }));
        for (const batch of chunks(blockRows, 80)) {
          this.db.insert(documentBlocks).values(batch).run();
        }

        const insertFts = this.sqlite.prepare(
          "INSERT INTO document_blocks_fts (block_id, book_id, page_index, text_normalized) VALUES (?, ?, ?, ?)",
        );
        const insertTrigram = this.sqlite.prepare(
          "INSERT INTO document_blocks_trigram (block_id, book_id, page_index, text_normalized) VALUES (?, ?, ?, ?)",
        );
        for (const block of blocks) {
          insertFts.run(block.id, block.bookId, block.pageIndex, block.textNormalized);
          insertTrigram.run(block.id, block.bookId, block.pageIndex, block.textNormalized);
        }
      }
    });
    replace();
  }

  public countBlocks(bookId: string): number {
    const row = this.sqlite.prepare<{ bookId: string }, { count: number }>(
      "SELECT count(*) AS count FROM document_blocks WHERE book_id = :bookId",
    ).get({ bookId });
    return row?.count ?? 0;
  }

  public getPage(bookId: string, pageIndex: number): DocumentPage | undefined {
    const row = this.sqlite.prepare<[string, number], Record<string, unknown>>(
      "SELECT * FROM document_pages WHERE book_id = ? AND page_index = ? LIMIT 1",
    ).get(bookId, pageIndex);
    return row ? toDocumentPage(row) : undefined;
  }

  /** Locate page text containing a literal normalized selection without exposing SQL/FTS syntax. */
  public findPagesContaining(bookId: string, needle: string, limit = 20): DocumentPage[] {
    if (!needle) return [];
    const bounded = Math.min(Math.max(limit, 1), 50);
    const rows = this.sqlite.prepare<[string, string, number], Record<string, unknown>>(
      `SELECT * FROM document_pages
       WHERE book_id = ? AND instr(text_normalized, ?) > 0
       ORDER BY page_index
       LIMIT ?`,
    ).all(bookId, needle, bounded);
    return rows.map(toDocumentPage);
  }

  /** Locate page text while ignoring PDF-extraction spaces inserted between glyphs. */
  public findPagesContainingCompact(bookId: string, compactNeedle: string, limit = 20): DocumentPage[] {
    if (!compactNeedle) return [];
    const bounded = Math.min(Math.max(limit, 1), 50);
    const rows = this.sqlite.prepare<[string, string, number], Record<string, unknown>>(
      `SELECT * FROM document_pages
       WHERE book_id = ? AND instr(replace(text_normalized, ' ', ''), ?) > 0
       ORDER BY page_index
       LIMIT ?`,
    ).all(bookId, compactNeedle, bounded);
    return rows.map(toDocumentPage);
  }

  public listBlocksByPage(bookId: string, pageIndex: number): DocumentBlock[] {
    const rows = this.db
      .select()
      .from(documentBlocks)
      .where(and(eq(documentBlocks.bookId, bookId), eq(documentBlocks.pageIndex, pageIndex)))
      .orderBy(asc(documentBlocks.blockOrder))
      .all();
    return rows.map(toDocumentBlock);
  }

  public listOutline(bookId: string): DocumentOutlineItem[] {
    return this.db.select().from(documentOutlineItems)
      .where(eq(documentOutlineItems.bookId, bookId))
      .orderBy(asc(documentOutlineItems.itemOrder))
      .all()
      .map((row) => ({
        id: row.id,
        title: row.title,
        pageIndex: row.pageIndex,
        depth: row.depth,
        order: row.itemOrder,
      }));
  }

  public listHeadings(bookId: string): DocumentBlock[] {
    return this.db
      .select()
      .from(documentBlocks)
      .where(and(eq(documentBlocks.bookId, bookId), eq(documentBlocks.kind, "heading")))
      .orderBy(asc(documentBlocks.pageIndex), asc(documentBlocks.blockOrder))
      .all()
      .map(toDocumentBlock);
  }

  public findBlockById(id: string): DocumentBlock | undefined {
    const row = this.db.select().from(documentBlocks).where(eq(documentBlocks.id, id)).get();
    return row ? toDocumentBlock(row) : undefined;
  }

  public findBlocksByIds(ids: string[]): DocumentBlock[] {
    if (ids.length === 0) return [];
    const statement = this.sqlite.prepare<[...string[]], Record<string, unknown>>(
      `SELECT * FROM document_blocks WHERE id IN (${ids.map(() => "?").join(",")})`,
    );
    return statement.all(...ids).map(toDocumentBlock);
  }


  /** Search the CJK-friendly trigram index with the same result shape as lexical FTS. */
  public searchTrigram(bookId: string, query: string, limit: number): DocumentSearchRow[] {
    return this.sqlite.prepare<[string, string, number], DocumentSearchRow>(
      `SELECT
        block_id AS blockId,
        bm25(document_blocks_trigram) AS rank,
        snippet(document_blocks_trigram, 3, '⟦', '⟧', ' … ', 24) AS snippet
      FROM document_blocks_trigram
      WHERE document_blocks_trigram MATCH ? AND book_id = ?
      ORDER BY rank
      LIMIT ?`,
    ).all(query, bookId, limit);
  }

  /** Exact substring fallback for short CJK queries that cannot form a trigram. */
  public searchSubstring(bookId: string, query: string, limit: number): DocumentSearchRow[] {
    const rows = this.sqlite.prepare<[string, string, number], { blockId: string; textNormalized: string }>(
      `SELECT id AS blockId, text_normalized AS textNormalized
       FROM document_blocks
       WHERE book_id = ? AND instr(text_normalized, ?) > 0
       ORDER BY page_index, block_order
       LIMIT ?`,
    ).all(bookId, query, limit);
    return rows.map((row, index) => ({
      blockId: row.blockId,
      rank: 1_000 + index,
      snippet: makeSubstringSnippet(row.textNormalized, query),
    }));
  }

  public search(bookId: string, ftsQuery: string, limit: number): DocumentSearchRow[] {
    return this.sqlite.prepare<[string, string, number], DocumentSearchRow>(
      `SELECT
        block_id AS blockId,
        bm25(document_blocks_fts) AS rank,
        snippet(document_blocks_fts, 3, '⟦', '⟧', ' … ', 24) AS snippet
      FROM document_blocks_fts
      WHERE document_blocks_fts MATCH ? AND book_id = ?
      ORDER BY rank
      LIMIT ?`,
    ).all(ftsQuery, bookId, limit);
  }
}


function makeSubstringSnippet(text: string, query: string): string {
  const match = text.indexOf(query);
  if (match < 0) return text.slice(0, 120);
  const start = Math.max(0, match - 36);
  const end = Math.min(text.length, match + query.length + 60);
  return `${start > 0 ? "… " : ""}${text.slice(start, match)}⟦${query}⟧${text.slice(match + query.length, end)}${end < text.length ? " …" : ""}`;
}

function toDocumentBlock(row: typeof documentBlocks.$inferSelect | Record<string, unknown>): DocumentBlock {
  const record = row as Record<string, unknown>;
  return documentBlockSchema.parse({
    id: record.id,
    bookId: record.bookId ?? record.book_id,
    pageIndex: record.pageIndex ?? record.page_index,
    blockOrder: record.blockOrder ?? record.block_order,
    kind: record.kind,
    textRaw: record.textRaw ?? record.text_raw,
    textNormalized: record.textNormalized ?? record.text_normalized,
    rects: JSON.parse(String(record.rectsJson ?? record.rects_json ?? "[]")),
    createdAt: record.createdAt ?? record.created_at,
  });
}

function toDocumentPage(row: Record<string, unknown>): DocumentPage {
  return documentPageSchema.parse({
    id: row.id,
    bookId: row.bookId ?? row.book_id,
    pageIndex: row.pageIndex ?? row.page_index,
    printedPageLabel: row.printedPageLabel ?? row.printed_page_label ?? null,
    textRaw: row.textRaw ?? row.text_raw,
    textNormalized: row.textNormalized ?? row.text_normalized,
    createdAt: row.createdAt ?? row.created_at,
  });
}


/** Keep multi-row INSERT statements below conservative SQLite bind-variable limits. */
function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
