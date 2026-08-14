import { describe, expect, it } from "vitest";
import { splitRichContent } from "./content-segments";

describe("splitRichContent", () => {
  it("extracts only Mermaid and visualization fences", () => {
    expect(splitRichContent([
      "before [S1]",
      "",
      "```mermaid",
      "flowchart LR",
      "A --> B",
      "```",
      "",
      "```visualization",
      '{"type":"comparison"}',
      "```",
      "",
      "after",
    ].join("\n"))).toEqual([
      { kind: "markdown", content: "before [S1]" },
      { kind: "mermaid", source: "flowchart LR\nA --> B" },
      { kind: "visualization", json: '{"type":"comparison"}' },
      { kind: "markdown", content: "after" },
    ]);
  });

  it("leaves arbitrary code and unclosed special fences as Markdown", () => {
    const markdown = "```tsx\nalert('no')\n```\n\n```mermaid\nA --> B";
    expect(splitRichContent(markdown)).toEqual([{ kind: "markdown", content: markdown }]);
  });
});
