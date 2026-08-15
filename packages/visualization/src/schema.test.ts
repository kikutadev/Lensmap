import { describe, expect, it } from "vitest";
import { visualizationSchema } from "./schema.js";

describe("visualizationSchema", () => {
  it("accepts the allow-listed React visualization families", () => {
    const samples = [
      {
        type: "comparison",
        title: "比較",
        sourceRefs: ["S1"],
        columns: [
          { title: "A", items: ["a"] },
          { title: "B", items: ["b"] },
        ],
      },
      {
        type: "flow",
        title: "処理",
        sourceRefs: ["S1", "S2"],
        nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
        edges: [{ source: "a", target: "b" }],
      },
      {
        type: "hierarchy",
        title: "階層",
        sourceRefs: [],
        nodes: [{ id: "root", label: "Root", parentId: null }],
      },
      {
        type: "timeline",
        title: "時系列",
        sourceRefs: ["S3"],
        items: [{ time: "Step 1", label: "開始", description: "説明" }],
      },
      {
        type: "matrix",
        title: "マトリクス",
        sourceRefs: ["S1"],
        rowLabels: ["R1"],
        columnLabels: ["C1"],
        cells: [{ row: 0, column: 0, text: "value" }],
      },
      {
        type: "callout",
        title: "定義",
        sourceRefs: ["S1"],
        tone: "definition",
        body: "本文",
      },
      {
        type: "chart",
        chartType: "bar",
        title: "数値",
        sourceRefs: ["S1"],
        dataNature: "source",
        xKey: "name",
        series: [{ dataKey: "value", label: "値" }],
        data: [{ name: "A", value: 1 }],
      },
    ];

    for (const sample of samples) {
      expect(visualizationSchema.safeParse(sample).success).toBe(true);
    }
  });

  it("rejects arbitrary visualization types and non-S# provenance", () => {
    expect(visualizationSchema.safeParse({
      type: "jsx",
      title: "unsafe",
      sourceRefs: [],
      code: "alert(1)",
    }).success).toBe(false);

    expect(visualizationSchema.safeParse({
      type: "callout",
      title: "bad ref",
      sourceRefs: ["page-1"],
      tone: "note",
      body: "x",
    }).success).toBe(false);
  });
});


it("accepts definition and table as first-class structured blocks", () => {
  expect(visualizationSchema.parse({ type: "definition", term: "LSM tree", definition: "A write-optimized tree", keyPoints: ["compaction"], sourceRefs: ["S1"] }).type).toBe("definition");
  expect(visualizationSchema.parse({ type: "table", title: "Comparison", columns: ["Aspect", "A", "B"], rows: [["Durability", "yes", "no"]], sourceRefs: ["S1", "S2"] }).type).toBe("table");
});
