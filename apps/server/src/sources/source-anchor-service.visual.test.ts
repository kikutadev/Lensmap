import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BookRepository } from "../books/book-repository.js";
import type { AppConfig } from "../config.js";
import { createDatabase, type DatabaseBundle } from "../persistence/database.js";
import { SourceAnchorRepository } from "./source-anchor-repository.js";
import { SourceAnchorService } from "./source-anchor-service.js";

let tempDir: string | undefined;
let database: DatabaseBundle | undefined;

afterEach(() => {
  database?.sqlite.close();
  database = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function fixture() {
  tempDir = mkdtempSync(join(tmpdir(), "lensmap-visual-source-"));
  const config: AppConfig = {
    host: "127.0.0.1",
    port: 4317,
    dataDir: tempDir,
    migrationsDir: join(process.cwd(), "drizzle"),
    codexBin: null,
    capabilityToken: null,
  };
  database = createDatabase(config);
  const books = new BookRepository(database.db);
  const now = new Date().toISOString();
  books.create({
    id: "book-visual",
    title: "Visual Book",
    fingerprint: "visual-fingerprint",
    fileName: "visual.pdf",
    managedPath: "/tmp/visual.pdf",
    pageCount: 1,
    createdAt: now,
    updatedAt: now,
  });
  return new SourceAnchorService(new SourceAnchorRepository(database.db), books, tempDir);
}

describe("Visual SourceAnchor", () => {
  it("persists the cropped PNG as primary evidence even when OCR and PDF location are unresolved", () => {
    const service = fixture();
    const source = service.createVisualSelection("book-visual", {
      captureImageWidthPx: 1440,
      captureImageHeightPx: 900,
      captureRectNormalized: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
      locationStatus: "unresolved",
      documentNodeIds: [],
    }, ONE_PIXEL_PNG);

    expect(source.kind).toBe("visual");
    if (source.kind !== "visual") throw new Error("Expected visual source");
    expect(source.locationStatus).toBe("unresolved");
    expect(source.page).toBeUndefined();
    expect(source.recognizedText).toBeUndefined();
    const path = service.resolveVisualAsset("book-visual", source.imageAssetId);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path)).toEqual(ONE_PIXEL_PNG);
    expect(service.listByBook("book-visual")[0]).toEqual(source);
  });

  it("rejects non-PNG bytes before creating a SourceAnchor", () => {
    const service = fixture();
    expect(() => service.createVisualSelection("book-visual", {
      captureImageWidthPx: 100,
      captureImageHeightPx: 100,
      captureRectNormalized: { x: 0, y: 0, width: 1, height: 1 },
      locationStatus: "unresolved",
      documentNodeIds: [],
    }, Buffer.from("not a png"))).toThrow(/PNG/u);
    expect(service.listByBook("book-visual")).toEqual([]);
  });
});
