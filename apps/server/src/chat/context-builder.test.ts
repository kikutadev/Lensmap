import { describe, expect, it } from "vitest";
import type { SourceAnchor } from "@deep-reader/shared";
import { ContextBuilder } from "./context-builder.js";

function source(id: string, text: string, pageStart: number): SourceAnchor {
  return {
    id,
    bookId: "book-1",
    pageStart,
    pageEnd: pageStart,
    quoteRaw: text,
    quoteNormalized: text,
    rects: [{ pageIndex: pageStart, x: 1, y: 2, width: 3, height: 4 }],
    textHash: `hash-${id}`,
    origin: "user-selection",
    documentNodeIds: [],
    createdAt: "2026-08-10T00:00:00.000Z",
  };
}

describe("ContextBuilder", () => {
  it("keeps all explicit sources and assigns stable source labels", () => {
    const result = new ContextBuilder().build("違いは？", [
      source("a", "alpha", 2),
      source("b", "beta", 8),
    ]);

    expect(result.sources.map((entry) => entry.label)).toEqual(["S1", "S2"]);
    expect(result.prompt).toContain('<source id="S1"');
    expect(result.prompt).toContain('<source id="S2"');
    expect(result.prompt).toContain("[S1]");
  });

  it("keeps conversation memory clearly non-citeable and separate from Sources", () => {
    const result = new ContextBuilder().build(
      "続きは？",
      [source("a", "book evidence", 1)],
      "User: 前にAを質問した\nAssistant: Aを整理した",
    );
    expect(result.prompt).toContain("Conversation Memory（会話継続用・引用根拠ではない）");
    expect(result.prompt).toContain("書籍本文の根拠として引用しないでください");
    expect(result.prompt.indexOf("Conversation Memory")).toBeLessThan(result.prompt.indexOf("## Sources"));
  });

  it("bounds source text by aggregate character budget without imposing a source-count cap", () => {
    const result = new ContextBuilder({ maxSourceCharacters: 10 }).build("説明して", [
      source("a", "abcdefgh", 0),
      source("b", "ijklmnop", 1),
      source("c", "qrstuv", 2),
    ]);

    expect(result.sources).toHaveLength(3);
    expect(result.sourceCharacters).toBeLessThanOrEqual(10);
    expect(result.truncatedSourceCount).toBeGreaterThan(0);
  });
});
