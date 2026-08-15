import { describe, expect, it } from "vitest";
import type { BookSearchResponse, TextSourceAnchor } from "@lensmap/shared";
import type { BookContextGateway, MaterializedBookSource } from "../documents/book-context-gateway.js";
import { WorkspaceToolSession, WORKSPACE_TOOL_SPECS } from "./workspace-tool-session.js";

function source(id: string, bookId: string, pageIndex: number, text: string, origin: "user-selection" | "ai-expansion" = "ai-expansion"): TextSourceAnchor {
  return {
    kind: "text",
    id, bookId, pageStart: pageIndex, pageEnd: pageIndex, quoteRaw: text, quoteNormalized: text,
    rects: [], textHash: `hash-${id}`, origin, documentNodeIds: [`block-${id}`], createdAt: new Date().toISOString(),
  };
}

class FakeGateway {
  public readonly searches: Array<{ bookId: string; query: string }> = [];
  public readonly reads: Array<{ bookId: string; blockIds: string[] }> = [];

  public async searchBook(bookId: string, query: string): Promise<BookSearchResponse> {
    this.searches.push({ bookId, query });
    return {
      query,
      hits: [{ block: { id: `block-${bookId}`, bookId, pageIndex: bookId === "book-a" ? 2 : 7, blockOrder: 0, kind: "paragraph", textRaw: `text ${bookId}`, textNormalized: `text ${bookId}`, rects: [], createdAt: new Date().toISOString() }, rank: 1, snippet: `snippet ${bookId}` }],
    };
  }

  public async readBlocks(bookId: string, blockIds: string[]): Promise<MaterializedBookSource[]> {
    this.reads.push({ bookId, blockIds });
    return blockIds.map((blockId, index) => ({ blockId, source: source(`source-${bookId}-${index}`, bookId, index + 3, `materialized ${bookId} ${blockId}`), reason: "read-block" }));
  }

  public async listSections(bookId: string) { return [{ id: `section-${bookId}`, title: `Section ${bookId}`, pageIndex: 1, depth: 0 }]; }
  public async readSection(bookId: string, sectionId: string): Promise<MaterializedBookSource[]> { return [{ blockId: `block-${sectionId}`, source: source(`source-${sectionId}`, bookId, 4, `section ${bookId}`), reason: "section" }]; }
  public async expandSource(bookId: string): Promise<MaterializedBookSource[]> { return [{ blockId: `near-${bookId}`, source: source(`near-${bookId}`, bookId, 5, `nearby ${bookId}`), reason: "nearby" }]; }
}

function createSession(gateway = new FakeGateway()) {
  return {
    gateway,
    session: new WorkspaceToolSession({
      workspaceId: "workspace-1",
      books: [{ id: "book-a", title: "Book A" }, { id: "book-b", title: "Book B" }],
      explicitSources: [{ label: "S1", source: source("explicit-a", "book-a", 1, "explicit", "user-selection") }],
      gateway: gateway as unknown as BookContextGateway,
    }),
  };
}

describe("WorkspaceToolSession", () => {
  it("exposes only Lensmap reader tools", () => {
    expect(WORKSPACE_TOOL_SPECS.map((tool) => tool.name)).toEqual([
      "lensmap_compose_map", "workspace_expand_source", "workspace_search", "workspace_read_blocks", "workspace_list_sections", "workspace_read_section",
    ]);
  });

  it("accepts exactly one grounded Map Draft and rejects unknown source labels", async () => {
    const { session } = createSession();
    const invalid = await session.handle({
      threadId: "thread", turnId: "turn", callId: "compose-invalid", tool: "lensmap_compose_map", namespace: null,
      arguments: {
        semanticKind: "definition",
        title: "Invalid",
        conciseExplanation: "",
        primary: { type: "definition", term: "Invalid", definition: "Unsupported", keyPoints: [], sourceRefs: ["S99"] },
        supportingBlocks: [],
        sourceRefs: ["S99"],
      },
    });
    expect(invalid.success).toBe(false);
    expect(invalid.contentItems[0]?.text).toContain("S99");
    expect(session.getMapDraft()).toBeNull();

    const acceptedArguments = {
      semanticKind: "definition",
      title: "Consensus",
      conciseExplanation: "A compact definition",
      primary: { type: "definition", term: "Consensus", definition: "Agreement on one state", keyPoints: [], sourceRefs: ["S1"] },
      supportingBlocks: [],
      sourceRefs: ["S1"],
    };
    const accepted = await session.handle({
      threadId: "thread", turnId: "turn", callId: "compose-1", tool: "lensmap_compose_map", namespace: null, arguments: acceptedArguments,
    });
    expect(accepted.success).toBe(true);
    expect(session.getMapDraft()).toMatchObject({ semanticKind: "definition", title: "Consensus" });

    const duplicate = await session.handle({
      threadId: "thread", turnId: "turn", callId: "compose-2", tool: "lensmap_compose_map", namespace: null, arguments: acceptedArguments,
    });
    expect(duplicate.success).toBe(false);
    expect(duplicate.contentItems[0]?.text).toContain("already submitted");
  });

  it("searches every Workspace PDF and keeps search hits non-citeable until read", async () => {
    const { gateway, session } = createSession();
    const result = await session.handle({ threadId: "thread", turnId: "turn", callId: "call", tool: "workspace_search", namespace: null, arguments: { query: "consensus", limit: 8 } });
    expect(result.success).toBe(true);
    expect(gateway.searches.map((item) => item.bookId)).toEqual(["book-a", "book-b"]);
    expect(result.contentItems[0]?.text).toContain("NOT citation sources");
    expect(session.getSourceLinks()).toEqual([]);
    expect(session.getAuditEvents()[0]?.resultSummary).toMatchObject({ candidateCount: 2 });
  });

  it("reads selected blocks from multiple PDFs and assigns stable S# labels after explicit sources", async () => {
    const { session } = createSession();
    const result = await session.handle({
      threadId: "thread", turnId: "turn", callId: "call", tool: "workspace_read_blocks", namespace: null,
      arguments: { blocks: [{ bookId: "book-a", blockId: "block-a" }, { bookId: "book-b", blockId: "block-b" }] },
    });
    expect(result.success).toBe(true);
    expect(result.contentItems[0]?.text).toContain("S2 | Book A");
    expect(result.contentItems[0]?.text).toContain("S3 | Book B");
    expect(session.getSourceLinks().map((link) => link.sourceLabel)).toEqual(["S2", "S3"]);
  });

  it("rejects attempts to read a PDF outside the active Workspace", async () => {
    const { session } = createSession();
    const result = await session.handle({
      threadId: "thread", turnId: "turn", callId: "call", tool: "workspace_read_blocks", namespace: null,
      arguments: { blocks: [{ bookId: "book-outside", blockId: "block-x" }] },
    });
    expect(result.success).toBe(false);
    expect(result.contentItems[0]?.text).toContain("not part of this workspace");
  });
});
