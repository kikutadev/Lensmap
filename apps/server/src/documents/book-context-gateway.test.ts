import { describe, expect, it } from "vitest";
import type { DocumentBlock, DocumentPage, TextSourceAnchor } from "@lensmap/shared";
import type { SourceAnchorService } from "../sources/source-anchor-service.js";
import type { DocumentIndexService } from "./document-index-service.js";
import { BookContextGateway } from "./book-context-gateway.js";

function block(id: string, pageIndex: number, blockOrder: number, text: string): DocumentBlock {
  return {
    id,
    bookId: "book-1",
    pageIndex,
    blockOrder,
    kind: "paragraph",
    textRaw: text,
    textNormalized: text,
    rects: [{ pageIndex, x: 10, y: 20, width: 100, height: 12 }],
    createdAt: new Date().toISOString(),
  };
}

function anchor(id: string, pageIndex: number, text: string, nodeIds: string[] = []): TextSourceAnchor {
  return {
    kind: "text",
    id,
    bookId: "book-1",
    pageStart: pageIndex,
    pageEnd: pageIndex,
    quoteRaw: text,
    quoteNormalized: text,
    rects: [{ pageIndex, x: 10, y: 20, width: 100, height: 12 }],
    textHash: `${id}-hash`,
    origin: id === "explicit" ? "user-selection" : "ai-expansion",
    documentNodeIds: nodeIds,
    createdAt: new Date().toISOString(),
  };
}

class FakeDocuments {
  public readonly blocks = [
    block("before", 0, 0, "before context"),
    block("current", 0, 1, "selected context"),
    block("after", 0, 2, "after context"),
  ];


  public async getOutline() {
    return { items: [{ id: "section-current", title: "selected context", pageIndex: 0, depth: 0, order: 0 }] };
  }

  public async searchBook() {
    return {
      query: "selected",
      hits: [{ block: this.blocks[1]!, rank: -1, snippet: "selected context" }],
    };
  }

  public async getBlocksByIds(_bookId: string, ids: string[]) {
    return ids.map((id) => this.blocks.find((candidate) => candidate.id === id)!).filter(Boolean);
  }

  public async getPageBlocks() {
    return this.blocks;
  }

  public async getPage(): Promise<DocumentPage> {
    return {
      id: "page-0",
      bookId: "book-1",
      pageIndex: 0,
      printedPageLabel: "12",
      textRaw: this.blocks.map((item) => item.textRaw).join("\n"),
      textNormalized: this.blocks.map((item) => item.textNormalized).join("\n"),
      createdAt: new Date().toISOString(),
    };
  }

  public getStatus() {
    return {
      bookId: "book-1",
      status: "indexed" as const,
      pageCount: 1,
      blockCount: this.blocks.length,
      indexedAt: new Date().toISOString(),
      error: null,
    };
  }
}

class FakeSources {
  public readonly explicit = anchor("explicit", 0, "selected context", ["current"]);
  public materialized: Array<{ pageIndex: number; nodeIds: string[] }> = [];

  public getById(id: string) {
    return id === this.explicit.id ? this.explicit : undefined;
  }

  public createAiExpansion(input: {
    pageIndex: number;
    documentNodeIds: string[];
    quoteNormalized: string;
    printedPageLabel?: string | null;
  }) {
    this.materialized.push({ pageIndex: input.pageIndex, nodeIds: input.documentNodeIds });
    return {
      ...anchor(`ai-${input.documentNodeIds[0]}`, input.pageIndex, input.quoteNormalized, input.documentNodeIds),
      printedPageLabelStart: input.printedPageLabel ?? undefined,
      printedPageLabelEnd: input.printedPageLabel ?? undefined,
    };
  }
}

describe("BookContextGateway", () => {
  it("does not create SourceAnchors merely because search returned candidates", async () => {
    const documents = new FakeDocuments();
    const sources = new FakeSources();
    const gateway = new BookContextGateway(
      documents as unknown as DocumentIndexService,
      sources as unknown as SourceAnchorService,
    );

    const result = await gateway.searchBook("book-1", "selected", 5);

    expect(result.hits).toHaveLength(1);
    expect(sources.materialized).toEqual([]);
  });

  it("materializes only blocks that are actually read and keeps their PDF provenance", async () => {
    const documents = new FakeDocuments();
    const sources = new FakeSources();
    const gateway = new BookContextGateway(
      documents as unknown as DocumentIndexService,
      sources as unknown as SourceAnchorService,
    );

    const result = await gateway.readBlocks("book-1", ["after"]);

    expect(result).toHaveLength(1);
    expect(result[0]?.source.origin).toBe("ai-expansion");
    expect(result[0]?.source.printedPageLabelStart).toBe("12");
    expect(result[0]?.source.documentNodeIds).toEqual(["after"]);
    expect(sources.materialized).toEqual([{ pageIndex: 0, nodeIds: ["after"] }]);
  });

  it("reads a bounded semantic section and materializes only the section blocks", async () => {
    const documents = new FakeDocuments();
    const sources = new FakeSources();
    const gateway = new BookContextGateway(
      documents as unknown as DocumentIndexService,
      sources as unknown as SourceAnchorService,
    );

    const result = await gateway.readSection("book-1", "section-current", 2);

    expect(result.map((item) => item.blockId)).toEqual(["current", "after"]);
    expect(result.every((item) => item.reason === "section")).toBe(true);
  });

  it("expands around a directly linked source block instead of searching the whole book", async () => {
    const documents = new FakeDocuments();
    const sources = new FakeSources();
    const gateway = new BookContextGateway(
      documents as unknown as DocumentIndexService,
      sources as unknown as SourceAnchorService,
    );

    const result = await gateway.expandSource("book-1", "explicit", 1, 1);

    expect(result.map((item) => item.blockId)).toEqual(["before", "after"]);
    expect(sources.materialized.map((item) => item.nodeIds[0])).toEqual(["before", "after"]);
  });
});
