import { describe, expect, it } from "vitest";
import { artifactBlockSchema } from "./insight.js";

describe("artifactBlockSchema", () => {
  it("accepts grounded blocks with multiple sources", () => {
    const parsed = artifactBlockSchema.parse({
      id: "block-1",
      kind: "markdown",
      order: 0,
      content: "CDN と Edge の関係",
      sourceAnchorIds: ["source-1", "source-2"],
      sourceRefs: [
        { label: "S1", sourceAnchorId: "source-1" },
        { label: "S2", sourceAnchorId: "source-2" },
      ],
      groundingKind: "derived",
      groundingStatus: "references-checked",
    });

    expect(parsed.sourceAnchorIds).toHaveLength(2);
  });
});
