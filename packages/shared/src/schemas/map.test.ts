import { describe, expect, it } from "vitest";
import { mapBlockSchema } from "./map.js";

describe("mapBlockSchema", () => {
  it("accepts grounded Map blocks with multiple sources", () => {
    const parsed = mapBlockSchema.parse({
      id: "block-1",
      kind: "narrative",
      order: 0,
      content: { markdown: "CDN と Edge の関係" },
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
