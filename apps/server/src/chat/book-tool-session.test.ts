import { describe, expect, it } from "vitest";
import type { BookSearchResponse, SourceAnchor } from "@deep-reader/shared";
import type { DynamicToolCallParams } from "../codex/protocol.js";
import type { BookContextGateway, MaterializedBookSource } from "../documents/book-context-gateway.js";
import { BookToolSession } from "./book-tool-session.js";

function source(id: string, origin: "user-selection" | "ai-expansion", page = 0, text = id): SourceAnchor {
  return {
    id,
    bookId: "book-1",
    pageStart: page,
    pageEnd: page,
    quoteRaw: text,
    quoteNormalized: text,
    rects: [{ pageIndex: page, x: 0, y: 0, width: 10, height: 10 }],
    textHash: `${id}-hash`,
    origin,
    documentNodeIds: [],
    createdAt: new Date().toISOString(),
  };
}

class FakeGateway {
  public readonly explicit = source("explicit", "user-selection", 0, "explicit source");
  public readonly searched = source("searched", "ai-expansion", 4, "searched block text");
  public readonly nearby = source("nearby", "ai-expansion", 1, "nearby context");

  public async listSections() {
    return [{ id: "section-1", title: "Architecture", pageIndex: 4, depth: 0, order: 0 }];
  }

  public async readSection(): Promise<MaterializedBookSource[]> {
    return [{ source: this.searched, blockId: "block-search", reason: "section" }];
  }

  public async searchBook(): Promise<BookSearchResponse> {
    return {
      query: "dependency inversion",
      hits: [{
        block: {
          id: "block-search",
          bookId: "book-1",
          pageIndex: 4,
          blockOrder: 0,
          kind: "paragraph",
          textRaw: this.searched.quoteRaw,
          textNormalized: this.searched.quoteNormalized,
          rects: this.searched.rects,
          createdAt: new Date().toISOString(),
        },
        rank: -1,
        snippet: "dependency inversion",
      }],
    };
  }

  public async readBlocks(): Promise<MaterializedBookSource[]> {
    return [{ source: this.searched, blockId: "block-search", reason: "read-block" }];
  }

  public async expandSource(): Promise<MaterializedBookSource[]> {
    return [{ source: this.nearby, blockId: "block-nearby", reason: "nearby" }];
  }
}

function request(tool: string, args: unknown): DynamicToolCallParams {
  return {
    threadId: "codex-thread",
    turnId: "codex-turn",
    callId: `call-${tool}`,
    namespace: null,
    tool,
    arguments: args,
  };
}

describe("BookToolSession", () => {
  it("lists sections as candidates and materializes a section only when explicitly read", async () => {
    const gateway = new FakeGateway();
    const session = new BookToolSession({
      bookId: "book-1",
      explicitSources: [{ label: "S1", source: gateway.explicit }],
      gateway: gateway as unknown as BookContextGateway,
    });

    const listed = await session.handle(request("book_list_sections", { query: "Architecture" }));
    expect(listed.success).toBe(true);
    expect(session.getSourceLinks()).toEqual([]);

    const read = await session.handle(request("book_read_section", { sectionId: "section-1", maxBlocks: 4 }));
    expect(read.success).toBe(true);
    expect(read.contentItems[0]?.text).toContain("S2");
    expect(session.getSourceLinks()[0]).toEqual(expect.objectContaining({ sourceAnchorId: "searched" }));
  });

  it("keeps search candidates non-citeable until the AI reads their blocks", async () => {
    const gateway = new FakeGateway();
    const session = new BookToolSession({
      bookId: "book-1",
      explicitSources: [{ label: "S1", source: gateway.explicit }],
      gateway: gateway as unknown as BookContextGateway,
    });

    const search = await session.handle(request("book_search", { query: "dependency inversion" }));
    expect(search.success).toBe(true);
    expect(session.getSourceLinks()).toEqual([]);

    const read = await session.handle(request("book_read_blocks", { blockIds: ["block-search"] }));
    expect(read.success).toBe(true);
    expect(read.contentItems[0]?.text).toContain("S2");
    expect(session.getSourceLinks()).toEqual([
      expect.objectContaining({ sourceAnchorId: "searched", sourceLabel: "S2", sourceOrder: 1 }),
    ]);

    const repeated = await session.handle(request("book_read_blocks", { blockIds: ["block-search"] }));
    expect(repeated.contentItems[0]?.text).toContain("S2");
    expect(session.getSourceLinks()).toHaveLength(1);
    expect(session.getAuditEvents().map((event) => event.toolName)).toEqual([
      "book_search",
      "book_read_blocks",
      "book_read_blocks",
    ]);
  });

  it("expands an explicit source with the next stable S# label", async () => {
    const gateway = new FakeGateway();
    const session = new BookToolSession({
      bookId: "book-1",
      explicitSources: [{ label: "S1", source: gateway.explicit }],
      gateway: gateway as unknown as BookContextGateway,
    });

    const result = await session.handle(request("book_expand_source", {
      sourceLabel: "S1",
      before: 1,
      after: 1,
    }));

    expect(result.success).toBe(true);
    expect(result.contentItems[0]?.text).toContain("S2");
    expect(session.getSourceLinks()[0]).toEqual(expect.objectContaining({
      sourceAnchorId: "nearby",
      sourceLabel: "S2",
    }));
  });

  it("clamps oversized model arguments and leaves enough bounded calls to read a search hit", async () => {
    const gateway = new FakeGateway();
    const session = new BookToolSession({
      bookId: "book-1",
      explicitSources: [{ label: "S1", source: gateway.explicit }],
      gateway: gateway as unknown as BookContextGateway,
    });

    for (let index = 0; index < 6; index += 1) {
      const search = await session.handle(request("book_search", {
        query: "dependency inversion",
        limit: 20,
      }));
      expect(search.success).toBe(true);
    }

    const read = await session.handle(request("book_read_blocks", {
      blockIds: Array.from({ length: 20 }, () => "block-search"),
    }));
    expect(read.success).toBe(true);
    expect(read.contentItems[0]?.text).toContain("S2");
  });

  it("enforces a separate expansion character budget", async () => {
    const gateway = new FakeGateway();
    gateway.searched.quoteNormalized = "x".repeat(500);
    gateway.searched.quoteRaw = gateway.searched.quoteNormalized;
    const session = new BookToolSession({
      bookId: "book-1",
      explicitSources: [{ label: "S1", source: gateway.explicit }],
      gateway: gateway as unknown as BookContextGateway,
      limits: { maxRetrievedCharacters: 100 },
    });

    await session.handle(request("book_read_blocks", { blockIds: ["block-search"] }));

    const link = session.getSourceLinks()[0];
    expect(link?.truncated).toBe(true);
    expect(link?.includedText.length).toBeLessThanOrEqual(100);
  });
});
