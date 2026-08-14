import { describe, expect, it } from "vitest";
import { parseMarkdownArtifactBlocks } from "./markdown-artifact-parser.js";

describe("parseMarkdownArtifactBlocks", () => {
  it("splits markdown, tables, Mermaid, and Visualization DSL while retaining provenance", () => {
    const blocks = parseMarkdownArtifactBlocks(
      [
        "要点です。[S1]",
        "",
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 | [S1][S2]",
        "",
        "```mermaid",
        "flowchart LR",
        "A --> B",
        "```",
        "",
        "```visualization",
        JSON.stringify({
          type: "comparison",
          title: "比較",
          sourceRefs: ["S2"],
          columns: [
            { title: "A", items: ["a"] },
            { title: "B", items: ["b"] },
          ],
        }),
        "```",
      ].join("\n"),
      [
        { label: "S1", sourceAnchorId: "source-1" },
        { label: "S2", sourceAnchorId: "source-2" },
      ],
    );

    expect(blocks.map((block) => block.kind)).toEqual(["markdown", "table", "diagram", "diagram"]);
    expect(blocks[0]?.sourceAnchorIds).toEqual(["source-1"]);
    expect(blocks[1]?.sourceAnchorIds).toEqual(["source-1", "source-2"]);
    expect(blocks[1]?.groundingKind).toBe("source-backed");
    expect(blocks[1]?.groundingStatus).toBe("references-checked");
    expect(blocks[2]?.content).toEqual({ format: "mermaid", source: "flowchart LR\nA --> B" });
    expect(blocks[3]?.sourceRefs).toEqual([{ label: "S2", sourceAnchorId: "source-2" }]);
    expect(blocks[3]?.content).toMatchObject({
      format: "visualization",
      visualization: { type: "comparison", title: "比較" },
    });
  });

  it("stores chart visualizations as chart blocks", () => {
    const blocks = parseMarkdownArtifactBlocks(
      `\`\`\`visualization\n${JSON.stringify({
        type: "chart",
        chartType: "bar",
        title: "値",
        sourceRefs: ["S1"],
        dataNature: "source",
        xKey: "name",
        series: [{ dataKey: "value", label: "Value" }],
        data: [{ name: "A", value: 1 }],
      })}\n\`\`\``,
      [{ label: "S1", sourceAnchorId: "source-1" }],
    );

    expect(blocks[0]?.kind).toBe("chart");
    expect(blocks[0]?.sourceAnchorIds).toEqual(["source-1"]);
  });

  it("marks unknown citation labels for review instead of accepting them as provenance", () => {
    const blocks = parseMarkdownArtifactBlocks("説明 [S9]", [
      { label: "S1", sourceAnchorId: "source-1" },
    ]);

    expect(blocks[0]?.sourceAnchorIds).toEqual([]);
    expect(blocks[0]?.invalidSourceLabels).toEqual(["S9"]);
    expect(blocks[0]?.groundingStatus).toBe("needs-review");
  });

  it("keeps malformed visualization JSON as ordinary Markdown", () => {
    const blocks = parseMarkdownArtifactBlocks("```visualization\n{bad json}\n```", []);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("markdown");
  });
});