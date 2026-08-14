import { createHash, randomUUID } from "node:crypto";
import {
  sourceAnchorSchema,
  type CreateSourceAnchorRequest,
  type PdfRect,
  type SourceAnchor,
} from "@deep-reader/shared";
import type { BookRepository } from "../books/book-repository.js";
import type { SourceAnchorRecord } from "./source-anchor-repository.js";
import { SourceAnchorRepository } from "./source-anchor-repository.js";

/** Create immutable source anchors and translate persistence JSON fields into domain objects. */
export class SourceAnchorService {
  public constructor(
    private readonly repository: SourceAnchorRepository,
    private readonly bookRepository: BookRepository,
  ) {}

  public createUserSelection(bookId: string, input: CreateSourceAnchorRequest): SourceAnchor {
    if (!this.bookRepository.findById(bookId)) {
      throw new Error("Book not found");
    }
    if (input.pageEnd < input.pageStart) {
      throw new Error("pageEnd must be greater than or equal to pageStart");
    }
    if (input.rects.some((rect) => rect.pageIndex < input.pageStart || rect.pageIndex > input.pageEnd)) {
      throw new Error("Selection rectangles must be within the selected page range");
    }

    const createdAt = new Date().toISOString();
    const created = this.repository.create({
      id: randomUUID(),
      bookId,
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
      createdAt,
    });

    return toSourceAnchor(created);
  }


  /** Materialize a retrieved document block as an immutable AI-expansion SourceAnchor, reusing exact matches. */
  public createAiExpansion(input: {
    bookId: string;
    pageIndex: number;
    printedPageLabel?: string | null;
    quoteRaw: string;
    quoteNormalized: string;
    rects: PdfRect[];
    documentNodeIds: string[];
  }): SourceAnchor {
    if (!this.bookRepository.findById(input.bookId)) throw new Error("Book not found");
    const textHash = createHash("sha256").update(input.quoteNormalized).digest("hex");
    const existing = this.repository.findAiExpansion(input.bookId, input.pageIndex, textHash);
    if (existing) return toSourceAnchor(existing);

    const created = this.repository.create({
      id: randomUUID(),
      bookId: input.bookId,
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
    return toSourceAnchor(created);
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
      if (!record) {
        throw new Error(`SourceAnchor not found: ${id}`);
      }
      if (record.bookId !== bookId) {
        throw new Error(`SourceAnchor belongs to a different book: ${id}`);
      }
      return toSourceAnchor(record);
    });
  }
}

function toSourceAnchor(record: SourceAnchorRecord): SourceAnchor {
  return sourceAnchorSchema.parse({
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
