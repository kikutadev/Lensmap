import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  sourceAnchorSchema,
  type CreateSourceAnchorRequest,
  type CreateVisualSourceRequest,
  type PdfRect,
  type SourceAnchor,
  type TextSourceAnchor,
  type VisualSourceAnchor,
} from "@lensmap/shared";
import type { BookRepository } from "../books/book-repository.js";
import type { SourceAnchorRecord } from "./source-anchor-repository.js";
import { SourceAnchorRepository } from "./source-anchor-repository.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_VISUAL_SOURCE_BYTES = 32 * 1024 * 1024;

/** Create immutable text/visual source anchors and translate persistence fields into domain objects. */
export class SourceAnchorService {
  private readonly visualAssetDir: string | null;

  public constructor(
    private readonly repository: SourceAnchorRepository,
    private readonly bookRepository: BookRepository,
    dataDir?: string,
  ) {
    this.visualAssetDir = dataDir ? join(dataDir, "visual-sources") : null;
  }

  public createUserSelection(bookId: string, input: CreateSourceAnchorRequest): TextSourceAnchor {
    if (!this.bookRepository.findById(bookId)) throw new Error("Book not found");
    if (input.pageEnd < input.pageStart) throw new Error("pageEnd must be greater than or equal to pageStart");
    if (input.rects.some((rect) => rect.pageIndex < input.pageStart || rect.pageIndex > input.pageEnd)) {
      throw new Error("Selection rectangles must be within the selected page range");
    }

    const created = this.repository.create({
      id: randomUUID(),
      bookId,
      kind: "text",
      pageStart: input.pageStart,
      pageEnd: input.pageEnd,
      printedPageLabelStart: input.printedPageLabelStart,
      printedPageLabelEnd: input.printedPageLabelEnd,
      quoteRaw: input.quoteRaw,
      quoteNormalized: input.quoteNormalized,
      prefix: input.prefix,
      suffix: input.suffix,
      rectsJson: JSON.stringify(input.rects),
      textHash: createHash("sha256").update(input.quoteNormalized).digest("hex"),
      origin: "user-selection",
      documentNodeIdsJson: JSON.stringify(input.documentNodeIds ?? []),
      createdAt: new Date().toISOString(),
    });
    return toSourceAnchor(created) as TextSourceAnchor;
  }

  /** Persist the cropped PNG as the primary source. OCR/location metadata remain optional derived fields. */
  public createVisualSelection(bookId: string, input: CreateVisualSourceRequest, png: Buffer): VisualSourceAnchor {
    if (!this.bookRepository.findById(bookId)) throw new Error("Book not found");
    if (!this.visualAssetDir) throw new Error("Visual source asset storage is not configured");
    validatePng(png);

    const id = randomUUID();
    const imageAssetId = randomUUID();
    mkdirSync(this.visualAssetDir, { recursive: true });
    const finalPath = join(this.visualAssetDir, `${imageAssetId}.png`);
    const tempPath = `${finalPath}.${randomUUID()}.tmp`;
    writeFileSync(tempPath, png, { flag: "wx" });

    try {
      renameSync(tempPath, finalPath);
      const recognizedText = input.recognizedText?.trim() || null;
      const page = input.page ?? null;
      const created = this.repository.create({
        id,
        bookId,
        kind: "visual",
        // Legacy text columns remain internal persistence placeholders; the visual domain object never exposes them as evidence.
        pageStart: page ?? 0,
        pageEnd: page ?? 0,
        quoteRaw: recognizedText ?? "[Visual Source]",
        quoteNormalized: recognizedText ?? "[Visual Source]",
        rectsJson: "[]",
        textHash: createHash("sha256").update(png).digest("hex"),
        imageAssetId,
        captureImageWidthPx: input.captureImageWidthPx,
        captureImageHeightPx: input.captureImageHeightPx,
        captureRectNormalizedJson: JSON.stringify(input.captureRectNormalized),
        locationStatus: input.locationStatus ?? "unresolved",
        visualPage: page,
        pageRectNormalizedJson: input.pageRectNormalized ? JSON.stringify(input.pageRectNormalized) : null,
        locationConfidence: toMicros(input.locationConfidence),
        recognizedText,
        ocrConfidence: toMicros(input.ocrConfidence),
        origin: "user-selection",
        documentNodeIdsJson: JSON.stringify(input.documentNodeIds ?? []),
        createdAt: new Date().toISOString(),
      });
      return toSourceAnchor(created) as VisualSourceAnchor;
    } catch (error) {
      try { unlinkSync(tempPath); } catch { /* best-effort cleanup */ }
      try { unlinkSync(finalPath); } catch { /* best-effort cleanup */ }
      throw error;
    }
  }

  /** Resolve a managed visual asset to its local path for authenticated preview or Codex localImage input. */
  public getVisualAssetPath(assetId: string): string {
    if (!this.visualAssetDir) throw new Error("Visual source asset storage is not configured");
    if (!/^[0-9a-f-]{36}$/iu.test(assetId)) throw new Error("Invalid visual asset id");
    return join(this.visualAssetDir, `${assetId}.png`);
  }

  public resolveVisualAsset(bookId: string, assetId: string): string {
    const record = this.repository.findByImageAssetId(assetId);
    if (!record || record.bookId !== bookId || record.kind !== "visual") throw new Error("Visual source asset not found");
    return this.getVisualAssetPath(assetId);
  }

  /** Materialize a retrieved document block as an immutable AI-expansion text SourceAnchor, reusing exact matches. */
  public createAiExpansion(input: {
    bookId: string;
    pageIndex: number;
    printedPageLabel?: string | null;
    quoteRaw: string;
    quoteNormalized: string;
    rects: PdfRect[];
    documentNodeIds: string[];
  }): TextSourceAnchor {
    if (!this.bookRepository.findById(input.bookId)) throw new Error("Book not found");
    const textHash = createHash("sha256").update(input.quoteNormalized).digest("hex");
    const existing = this.repository.findAiExpansion(input.bookId, input.pageIndex, textHash);
    if (existing) return toSourceAnchor(existing) as TextSourceAnchor;

    const created = this.repository.create({
      id: randomUUID(),
      bookId: input.bookId,
      kind: "text",
      pageStart: input.pageIndex,
      pageEnd: input.pageIndex,
      printedPageLabelStart: input.printedPageLabel ?? undefined,
      printedPageLabelEnd: input.printedPageLabel ?? undefined,
      quoteRaw: input.quoteRaw,
      quoteNormalized: input.quoteNormalized,
      rectsJson: JSON.stringify(input.rects),
      textHash,
      origin: "ai-expansion",
      documentNodeIdsJson: JSON.stringify(input.documentNodeIds),
      createdAt: new Date().toISOString(),
    });
    return toSourceAnchor(created) as TextSourceAnchor;
  }

  public getById(id: string): SourceAnchor | undefined {
    const record = this.repository.findById(id);
    return record ? toSourceAnchor(record) : undefined;
  }

  public listByBook(bookId: string): SourceAnchor[] {
    return this.repository.listByBook(bookId).map(toSourceAnchor);
  }

  /** Resolve an ordered set of anchors and reject cross-book/missing source IDs. */
  public getOrderedForBook(bookId: string, sourceIds: string[]): SourceAnchor[] {
    const uniqueIds = [...new Set(sourceIds)];
    const records = this.repository.findByIds(uniqueIds);
    const byId = new Map(records.map((record) => [record.id, record]));
    return uniqueIds.map((id) => {
      const record = byId.get(id);
      if (!record) throw new Error(`SourceAnchor not found: ${id}`);
      if (record.bookId !== bookId) throw new Error(`SourceAnchor belongs to a different book: ${id}`);
      return toSourceAnchor(record);
    });
  }
}

export function toSourceAnchor(record: SourceAnchorRecord): SourceAnchor {
  if (record.kind === "visual") {
    if (!record.imageAssetId || !record.captureImageWidthPx || !record.captureImageHeightPx || !record.captureRectNormalizedJson) {
      throw new Error(`Visual SourceAnchor is incomplete: ${record.id}`);
    }
    return sourceAnchorSchema.parse({
      kind: "visual",
      id: record.id,
      bookId: record.bookId,
      imageAssetId: record.imageAssetId,
      captureImageWidthPx: record.captureImageWidthPx,
      captureImageHeightPx: record.captureImageHeightPx,
      captureRectNormalized: JSON.parse(record.captureRectNormalizedJson),
      locationStatus: record.locationStatus ?? "unresolved",
      ...(record.visualPage === null ? {} : { page: record.visualPage }),
      ...(record.pageRectNormalizedJson ? { pageRectNormalized: JSON.parse(record.pageRectNormalizedJson) } : {}),
      ...(record.locationConfidence === null ? {} : { locationConfidence: fromMicros(record.locationConfidence) }),
      ...(record.recognizedText ? { recognizedText: record.recognizedText } : {}),
      ...(record.ocrConfidence === null ? {} : { ocrConfidence: fromMicros(record.ocrConfidence) }),
      origin: record.origin,
      documentNodeIds: JSON.parse(record.documentNodeIdsJson),
      createdAt: record.createdAt,
    });
  }

  return sourceAnchorSchema.parse({
    kind: "text",
    id: record.id,
    bookId: record.bookId,
    pageStart: record.pageStart,
    pageEnd: record.pageEnd,
    ...(record.printedPageLabelStart ? { printedPageLabelStart: record.printedPageLabelStart } : {}),
    ...(record.printedPageLabelEnd ? { printedPageLabelEnd: record.printedPageLabelEnd } : {}),
    quoteRaw: record.quoteRaw,
    quoteNormalized: record.quoteNormalized,
    ...(record.prefix ? { prefix: record.prefix } : {}),
    ...(record.suffix ? { suffix: record.suffix } : {}),
    rects: JSON.parse(record.rectsJson),
    textHash: record.textHash,
    origin: record.origin,
    documentNodeIds: JSON.parse(record.documentNodeIdsJson),
    createdAt: record.createdAt,
  });
}

function validatePng(png: Buffer): void {
  if (png.length === 0 || png.length > MAX_VISUAL_SOURCE_BYTES) throw new Error("Visual Source PNG must be between 1 byte and 32 MB");
  if (png.length < PNG_SIGNATURE.length || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Visual Source must be a PNG image");
  }
}

function toMicros(value: number | undefined): number | null {
  return value === undefined ? null : Math.round(value * 1_000_000);
}
function fromMicros(value: number): number { return value / 1_000_000; }
