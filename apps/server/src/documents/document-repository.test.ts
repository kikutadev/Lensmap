import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BookRepository } from "../books/book-repository.js";
import type { AppConfig } from "../config.js";
import { createDatabase, type DatabaseBundle } from "../persistence/database.js";
import { DocumentRepository } from "./document-repository.js";

let tempDir: string | undefined;
let database: DatabaseBundle | undefined;

afterEach(() => {
  database?.sqlite.close();
  database = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

function createTestConfig(): AppConfig {
  tempDir = mkdtempSync(join(tmpdir(), "lensmap-document-repository-"));
  return {
    host: "127.0.0.1",
    port: 4317,
    dataDir: tempDir,
    migrationsDir: join(process.cwd(), "drizzle"),
    codexBin: null,
  };
}

describe("DocumentRepository", () => {
  it("replaces large indexes without exceeding SQLite bind-variable limits", () => {
    database = createDatabase(createTestConfig());
    const repository = new DocumentRepository(database.db, database.sqlite);
    const books = new BookRepository(database.db);
    const now = new Date().toISOString();
    const bookId = "large-book";
    books.create({
      id: bookId,
      title: "Large book",
      fingerprint: "large-book-fingerprint",
      fileName: "large.pdf",
      managedPath: "/tmp/large.pdf",
      pageCount: null,
      createdAt: now,
      updatedAt: now,
    });
    const pages = Array.from({ length: 320 }, (_, pageIndex) => ({
      id: `page-${pageIndex}`,
      bookId,
      pageIndex,
      printedPageLabel: String(pageIndex + 1),
      textRaw: `Page ${pageIndex + 1} body text`,
      textNormalized: `Page ${pageIndex + 1} body text`,
      createdAt: now,
    }));
    const blocks = Array.from({ length: 1_600 }, (_, index) => ({
      id: `block-${index}`,
      bookId,
      pageIndex: Math.floor(index / 5),
      blockOrder: index % 5,
      kind: "paragraph" as const,
      textRaw: `Block ${index} searchable content`,
      textNormalized: `Block ${index} searchable content`,
      rects: [{ pageIndex: Math.floor(index / 5), x: 10, y: 20, width: 100, height: 12 }],
      createdAt: now,
    }));

    repository.replaceBookIndex(bookId, pages, blocks);

    expect(repository.countBlocks(bookId)).toBe(1_600);
    expect(repository.getPage(bookId, 319)?.textRaw).toContain("Page 320");
  });
});
