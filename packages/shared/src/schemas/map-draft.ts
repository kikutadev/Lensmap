import { z } from "zod";

export const mapSemanticKindSchema = z.enum([
  "definition",
  "comparison",
  "causal",
  "process",
  "hierarchy",
  "timeline",
  "quantitative",
  "synthesis",
]);

const sourceRefsSchema = z.array(z.string().regex(/^S\d+$/)).max(32).default([]);
const titleSchema = z.string().trim().min(1).max(200);

const definitionBlockSchema = z.object({
  type: z.literal("definition"),
  title: titleSchema.optional(),
  term: z.string().trim().min(1).max(200),
  definition: z.string().trim().min(1).max(6_000),
  keyPoints: z.array(z.string().trim().min(1).max(1_000)).max(12).default([]),
  sourceRefs: sourceRefsSchema,
});

const tableBlockSchema = z.object({
  type: z.literal("table"),
  title: titleSchema,
  columns: z.array(z.string().trim().min(1).max(200)).min(1).max(12),
  rows: z.array(z.array(z.string().max(2_000)).min(1).max(12)).max(120),
  sourceRefs: sourceRefsSchema,
});

const comparisonBlockSchema = z.object({
  type: z.literal("comparison"),
  title: titleSchema,
  columns: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    items: z.array(z.string().max(500)).max(20),
  })).min(2).max(4),
  sourceRefs: sourceRefsSchema,
});

const flowBlockSchema = z.object({
  type: z.literal("flow"),
  title: titleSchema,
  direction: z.enum(["LR", "TB"]).default("LR"),
  nodes: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(200),
    detail: z.string().max(500).optional(),
  })).min(2).max(30),
  edges: z.array(z.object({
    source: z.string().trim().min(1).max(80),
    target: z.string().trim().min(1).max(80),
    label: z.string().max(120).optional(),
  })).min(1).max(60),
  sourceRefs: sourceRefsSchema,
});

const hierarchyBlockSchema = z.object({
  type: z.literal("hierarchy"),
  title: titleSchema,
  nodes: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(200),
    parentId: z.string().trim().min(1).max(80).nullable(),
    detail: z.string().max(500).optional(),
  })).min(1).max(60),
  sourceRefs: sourceRefsSchema,
});

const timelineBlockSchema = z.object({
  type: z.literal("timeline"),
  title: titleSchema,
  items: z.array(z.object({
    label: z.string().trim().min(1).max(200),
    time: z.string().max(120).optional(),
    description: z.string().max(1_000).optional(),
  })).min(1).max(40),
  sourceRefs: sourceRefsSchema,
});

const matrixBlockSchema = z.object({
  type: z.literal("matrix"),
  title: titleSchema,
  rowLabels: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  columnLabels: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
  cells: z.array(z.object({
    row: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    text: z.string().max(1_000),
  })).max(240),
  sourceRefs: sourceRefsSchema,
});

const calloutBlockSchema = z.object({
  type: z.literal("callout"),
  title: titleSchema,
  tone: z.enum(["definition", "important", "note", "warning"]),
  body: z.string().trim().min(1).max(4_000),
  bullets: z.array(z.string().max(1_000)).max(12).default([]),
  sourceRefs: sourceRefsSchema,
});

const chartBlockSchema = z.object({
  type: z.literal("chart"),
  chartType: z.enum(["bar", "line", "scatter"]),
  title: titleSchema,
  dataNature: z.enum(["source", "derived", "illustrative"]),
  xKey: z.string().trim().min(1).max(120),
  series: z.array(z.object({
    dataKey: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(200),
    valuePrefix: z.string().max(40).optional(),
    valueSuffix: z.string().max(40).optional(),
  })).min(1).max(8),
  data: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).max(500),
  sourceRefs: sourceRefsSchema,
});

const narrativeBlockSchema = z.object({
  type: z.literal("narrative"),
  title: titleSchema.optional(),
  body: z.string().trim().min(1).max(12_000),
  sourceRefs: sourceRefsSchema,
});

export const structuredMapBlockSchema = z.discriminatedUnion("type", [
  definitionBlockSchema,
  tableBlockSchema,
  comparisonBlockSchema,
  flowBlockSchema,
  hierarchyBlockSchema,
  timelineBlockSchema,
  matrixBlockSchema,
  calloutBlockSchema,
  chartBlockSchema,
  narrativeBlockSchema,
]);

export const mapDraftSchema = z.object({
  semanticKind: mapSemanticKindSchema,
  title: titleSchema,
  conciseExplanation: z.string().trim().max(8_000).default(""),
  primary: structuredMapBlockSchema,
  supportingBlocks: z.array(structuredMapBlockSchema).max(8).default([]),
  sourceRefs: sourceRefsSchema,
});

export type MapSemanticKind = z.infer<typeof mapSemanticKindSchema>;
export type StructuredMapBlock = z.infer<typeof structuredMapBlockSchema>;
export type MapDraft = z.infer<typeof mapDraftSchema>;
