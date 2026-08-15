import { z } from "zod";

const sourceRefsSchema = z.array(z.string().regex(/^S\d+$/));
const dataNatureSchema = z.enum(["source", "derived", "illustrative"]);


export const definitionVisualizationSchema = z.object({
  type: z.literal("definition"),
  title: z.string().min(1).optional(),
  term: z.string().min(1).max(200),
  definition: z.string().min(1).max(6_000),
  keyPoints: z.array(z.string().max(1_000)).max(12).default([]),
  sourceRefs: sourceRefsSchema,
});

export const tableVisualizationSchema = z.object({
  type: z.literal("table"),
  title: z.string().min(1),
  columns: z.array(z.string().min(1).max(200)).min(1).max(12),
  rows: z.array(z.array(z.string().max(2_000)).min(1).max(12)).max(120),
  sourceRefs: sourceRefsSchema,
});

const chartSeriesSchema = z.object({
  dataKey: z.string().min(1),
  label: z.string().min(1),
  valuePrefix: z.string().optional(),
  valueSuffix: z.string().optional(),
});

export const chartVisualizationSchema = z.object({
  type: z.literal("chart"),
  chartType: z.enum(["bar", "line", "scatter"]),
  title: z.string().min(1),
  sourceRefs: sourceRefsSchema,
  dataNature: dataNatureSchema,
  xKey: z.string().min(1),
  series: z.array(chartSeriesSchema).min(1).max(8),
  data: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).max(500),
});

export const comparisonVisualizationSchema = z.object({
  type: z.literal("comparison"),
  title: z.string().min(1),
  sourceRefs: sourceRefsSchema,
  columns: z.array(z.object({
    title: z.string().min(1),
    items: z.array(z.string().max(500)).max(20),
  })).min(2).max(4),
});

export const flowVisualizationSchema = z.object({
  type: z.literal("flow"),
  title: z.string().min(1),
  sourceRefs: sourceRefsSchema,
  direction: z.enum(["LR", "TB"]).default("LR"),
  nodes: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1).max(200),
    detail: z.string().max(500).optional(),
  })).min(2).max(30),
  edges: z.array(z.object({
    source: z.string().min(1),
    target: z.string().min(1),
    label: z.string().max(120).optional(),
  })).min(1).max(60),
});

export const hierarchyVisualizationSchema = z.object({
  type: z.literal("hierarchy"),
  title: z.string().min(1),
  sourceRefs: sourceRefsSchema,
  nodes: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1).max(200),
    parentId: z.string().min(1).nullable(),
    detail: z.string().max(500).optional(),
  })).min(1).max(60),
});

export const timelineVisualizationSchema = z.object({
  type: z.literal("timeline"),
  title: z.string().min(1),
  sourceRefs: sourceRefsSchema,
  items: z.array(z.object({
    label: z.string().min(1).max(200),
    time: z.string().max(120).optional(),
    description: z.string().max(1_000).optional(),
  })).min(1).max(40),
});

export const matrixVisualizationSchema = z.object({
  type: z.literal("matrix"),
  title: z.string().min(1),
  sourceRefs: sourceRefsSchema,
  rowLabels: z.array(z.string().min(1).max(120)).min(1).max(20),
  columnLabels: z.array(z.string().min(1).max(120)).min(1).max(12),
  cells: z.array(z.object({
    row: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    text: z.string().max(1_000),
  })).max(240),
});

export const calloutVisualizationSchema = z.object({
  type: z.literal("callout"),
  title: z.string().min(1),
  sourceRefs: sourceRefsSchema,
  tone: z.enum(["definition", "important", "note", "warning"]),
  body: z.string().min(1).max(4_000),
  bullets: z.array(z.string().max(1_000)).max(12).default([]),
});

export const visualizationSchema = z.discriminatedUnion("type", [
  definitionVisualizationSchema,
  tableVisualizationSchema,
  chartVisualizationSchema,
  comparisonVisualizationSchema,
  flowVisualizationSchema,
  hierarchyVisualizationSchema,
  timelineVisualizationSchema,
  matrixVisualizationSchema,
  calloutVisualizationSchema,
]);

export type Visualization = z.infer<typeof visualizationSchema>;
export type ChartVisualization = z.infer<typeof chartVisualizationSchema>;
