import { describe, expect, it } from "vitest";
import { splitRichContent } from "./content-segments";

describe("splitRichContent", () => {
  it("extracts only allow-listed Mermaid and visualization fences", () => {
    expect(splitRichContent([
      "説明",
      "```mermaid",
      "flowchart LR",
      "A --> B",
      "```",
      "続き",
      "```visualization",
      '{"type":"callout","title":"x"}',
      "```",
    ].join("\n"))).toEqual([
      { kind: "markdown", content: "説明" },
      { kind: "mermaid", source: "flowchart LR\nA --> B" },
      { kind: "markdown", content: "続き" },
      { kind: "visualization", json: '{"type":"callout","title":"x"}' },
    ]);
  });

  it("keeps ordinary JavaScript fences inert Markdown", () => {
    const markdown = "```js\nalert('no')\n```";
    expect(splitRichContent(markdown)).toEqual([{ kind: "markdown", content: markdown }]);
  });
});
