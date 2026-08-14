import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BookRepository } from "../books/book-repository.js";
import type { AppConfig } from "../config.js";
import { createDatabase, type DatabaseBundle } from "../persistence/database.js";
import { DocumentIndexService, buildFtsQuery, buildTrigramQuery } from "./document-index-service.js";
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
  tempDir = mkdtempSync(join(tmpdir(), "deep-reader-document-test-"));
  return {
    host: "127.0.0.1",
    port: 4317,
    dataDir: tempDir,
    migrationsDir: join(process.cwd(), "drizzle"),
    codexBin: null,
  };
}

describe("DocumentIndexService", () => {
  it("retrieves structured blocks through the local FTS5 index", async () => {
    database = createDatabase(createTestConfig());
    const books = new BookRepository(database.db);
    const documents = new DocumentRepository(database.db, database.sqlite);
    const now = new Date().toISOString();
    books.create({
      id: "book-1",
      title: "Architecture",
      fingerprint: "fingerprint-document",
      fileName: "book.pdf",
      managedPath: "/tmp/book.pdf",
      pageCount: null,
      createdAt: now,
      updatedAt: now,
    });
    documents.replaceBookIndex(
      "book-1",
      [{
        id: "page-0",
        bookId: "book-1",
        pageIndex: 0,
        printedPageLabel: "1",
        textRaw: "Dependency inversion separates policy from implementation.",
        textNormalized: "Dependency inversion separates policy from implementation.",
        createdAt: now,
      }],
      [{
        id: "block-0",
        bookId: "book-1",
        pageIndex: 0,
        blockOrder: 0,
        kind: "paragraph",
        textRaw: "Dependency inversion separates policy from implementation.",
        textNormalized: "Dependency inversion separates policy from implementation.",
        rects: [{ pageIndex: 0, x: 10, y: 20, width: 100, height: 12 }],
        createdAt: now,
      }],
    );
    books.updateIndexMetadata("book-1", 1, now);
    const service = new DocumentIndexService(documents, books);

    const result = await service.searchBook("book-1", "Dependency inversion", 10);

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.block.id).toBe("block-0");
    expect(result.hits[0]?.snippet).toContain("⟦Dependency⟧");
  });

  it("retrieves Japanese partial phrases through the trigram/substring hybrid index", async () => {
    database = createDatabase(createTestConfig());
    const books = new BookRepository(database.db);
    const documents = new DocumentRepository(database.db, database.sqlite);
    const now = new Date().toISOString();
    books.create({
      id: "book-ja",
      title: "設計原則",
      fingerprint: "fingerprint-ja",
      fileName: "ja.pdf",
      managedPath: "/tmp/ja.pdf",
      pageCount: null,
      createdAt: now,
      updatedAt: now,
    });
    documents.replaceBookIndex(
      "book-ja",
      [{
        id: "page-ja",
        bookId: "book-ja",
        pageIndex: 0,
        printedPageLabel: "1",
        textRaw: "依存性逆転の原則は高水準の方針を守る。",
        textNormalized: "依存性逆転の原則は高水準の方針を守る。",
        createdAt: now,
      }],
      [{
        id: "block-ja",
        bookId: "book-ja",
        pageIndex: 0,
        blockOrder: 0,
        kind: "paragraph",
        textRaw: "依存性逆転の原則は高水準の方針を守る。",
        textNormalized: "依存性逆転の原則は高水準の方針を守る。",
        rects: [{ pageIndex: 0, x: 10, y: 20, width: 100, height: 12 }],
        createdAt: now,
      }],
    );
    books.updateIndexMetadata("book-ja", 1, now);
    const service = new DocumentIndexService(documents, books);

    const phrase = await service.searchBook("book-ja", "依存性逆転", 10);
    const short = await service.searchBook("book-ja", "方針", 10);

    expect(phrase.hits.map((hit) => hit.block.id)).toContain("block-ja");
    expect(short.hits.map((hit) => hit.block.id)).toContain("block-ja");
  });

  it("resolves viewer selection text back to page blocks", async () => {
    database = createDatabase(createTestConfig());
    const books = new BookRepository(database.db);
    const documents = new DocumentRepository(database.db, database.sqlite);
    const now = new Date().toISOString();
    books.create({
      id: "book-resolve", title: "Viewer Book", fingerprint: "fingerprint-resolve", fileName: "viewer.pdf",
      managedPath: "/tmp/viewer.pdf", pageCount: null, createdAt: now, updatedAt: now,
    });
    documents.replaceBookIndex(
      "book-resolve",
      [{
        id: "page-resolve", bookId: "book-resolve", pageIndex: 1, printedPageLabel: "2",
        textRaw: "Local caches reduce origin load and keep hot reads close to callers.",
        textNormalized: "Local caches reduce origin load and keep hot reads close to callers.", createdAt: now,
      }],
      [{
        id: "block-resolve", bookId: "book-resolve", pageIndex: 1, blockOrder: 0, kind: "paragraph",
        textRaw: "Local caches reduce origin load and keep hot reads close to callers.",
        textNormalized: "Local caches reduce origin load and keep hot reads close to callers.",
        rects: [{ pageIndex: 1, x: 20, y: 30, width: 220, height: 14 }], createdAt: now,
      }],
    );
    books.updateIndexMetadata("book-resolve", 1, now);
    const service = new DocumentIndexService(documents, books);

    const resolved = await service.resolveSelectionText("book-resolve", "reduce origin load");

    expect(resolved.candidates).toHaveLength(1);
    expect(resolved.candidates[0]).toMatchObject({
      pageStart: 1, pageEnd: 1, confidence: "exact-page", documentNodeIds: ["block-resolve"],
    });
    expect(resolved.candidates[0]?.rects).toHaveLength(1);
  });


  it("resolves viewer text when PDF extraction inserts spaces between glyphs", async () => {
    database = createDatabase(createTestConfig());
    const books = new BookRepository(database.db);
    const documents = new DocumentRepository(database.db, database.sqlite);
    const now = new Date().toISOString();
    books.create({
      id: "book-spaced", title: "Spaced glyph PDF", fingerprint: "fingerprint-spaced", fileName: "spaced.pdf",
      managedPath: "/tmp/spaced.pdf", pageCount: null, createdAt: now, updatedAt: now,
    });
    documents.replaceBookIndex(
      "book-spaced",
      [{
        id: "page-spaced", bookId: "book-spaced", pageIndex: 45, printedPageLabel: "46",
        textRaw: "画 彼 の 名 前 を た ず ね るa s k h i s n a m e",
        textNormalized: "画 彼 の 名 前 を た ず ね るa s k h i s n a m e", createdAt: now,
      }],
      [{
        id: "block-spaced", bookId: "book-spaced", pageIndex: 45, blockOrder: 10, kind: "paragraph",
        textRaw: "画 彼 の 名 前 を た ず ね るa s k h i s n a m e",
        textNormalized: "画 彼 の 名 前 を た ず ね るa s k h i s n a m e",
        rects: [{ pageIndex: 45, x: 20, y: 30, width: 220, height: 14 }], createdAt: now,
      }],
    );
    books.updateIndexMetadata("book-spaced", 46, now);
    const service = new DocumentIndexService(documents, books);

    const resolved = await service.resolveSelectionText("book-spaced", "ask his name");

    expect(resolved.candidates).toHaveLength(1);
    expect(resolved.candidates[0]).toMatchObject({
      pageStart: 45, pageEnd: 45, confidence: "exact-page", documentNodeIds: ["block-spaced"],
    });
  });

  it("does not treat an empty persisted index as successfully indexed", () => {
    database = createDatabase(createTestConfig());
    const books = new BookRepository(database.db);
    const documents = new DocumentRepository(database.db, database.sqlite);
    const now = new Date().toISOString();
    books.create({
      id: "book-empty", title: "Empty index", fingerprint: "fingerprint-empty", fileName: "empty.pdf",
      managedPath: "/tmp/empty.pdf", pageCount: null, createdAt: now, updatedAt: now,
    });
    books.updateIndexMetadata("book-empty", 288, now);
    const service = new DocumentIndexService(documents, books);

    expect(service.getStatus("book-empty")).toMatchObject({
      status: "not-indexed",
      pageCount: 288,
      blockCount: 0,
    });
  });

  it("quotes FTS terms instead of accepting query syntax", () => {
    expect(buildFtsQuery('edge OR "runtime"')).toBe('"edge" AND "OR" AND """runtime"""');
    expect(buildTrigramQuery('依存性"逆転')).toBe('"依存性""逆転"');
  });
});
