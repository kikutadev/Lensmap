import { z } from "zod";
import { sourceOriginSchema } from "./source-anchor.js";

export const groundingKindSchema = z.enum(["source-backed", "derived", "ai-explanation"]);
export const groundingStatusSchema = z.enum(["references-checked", "claim-verified", "modified", "needs-review"]);

export const mapBlockKindSchema = z.enum([
  "narrative",
  "callout",
  "table",
  "diagram",
  "chart",
  "visual-reference",
]);

export const mapBlockSourceRefSchema = z.object({
  label: z.string().regex(/^S\d+$/),
  sourceAnchorId: z.string().min(1),
});

export const mapBlockSchema = z.object({
  id: z.string().min(1),
  kind: mapBlockKindSchema,
  order: z.number().int().nonnegative(),
  content: z.unknown(),
  sourceAnchorIds: z.array(z.string()),
  sourceRefs: z.array(mapBlockSourceRefSchema),
  groundingKind: groundingKindSchema,
  groundingStatus: groundingStatusSchema,
});

/** A Map is one durable understanding outcome; presentation form lives in its version blocks, not on the artifact identity. */
export const mapArtifactSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  title: z.string().min(1),
  conciseExplanation: z.string(),
  sourceAnchorIds: z.array(z.string()),
  originTurnIds: z.array(z.string()),
  createdBy: z.enum(["ai", "user", "mixed"]),
  tags: z.array(z.string().min(1).max(40)),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().positive(),
  blocks: z.array(mapBlockSchema),
});

export const mapSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    sourceAnchorId: z.string().min(1),
    bookId: z.string().min(1),
    bookTitle: z.string().min(1),
    pageStart: z.number().int().nonnegative(),
    pageEnd: z.number().int().nonnegative(),
    printedPageLabelStart: z.string().nullable(),
    printedPageLabelEnd: z.string().nullable(),
    quoteRaw: z.string().min(1),
    origin: sourceOriginSchema,
  }),
  z.object({
    kind: z.literal("visual"),
    sourceAnchorId: z.string().min(1),
    bookId: z.string().min(1),
    bookTitle: z.string().min(1),
    imageAssetId: z.string().min(1),
    locationStatus: z.enum(["unresolved", "page-resolved", "rect-resolved"]),
    page: z.number().int().nonnegative().nullable(),
    recognizedText: z.string().nullable(),
    origin: sourceOriginSchema,
  }),
]);

export const mapArtifactDetailSchema = z.object({ artifact: mapArtifactSchema, sources: z.array(mapSourceSchema) });

export const mapArtifactSummarySchema = mapArtifactSchema.omit({ blocks: true, sourceAnchorIds: true }).extend({
  sourceCount: z.number().int().nonnegative(),
  sourcePages: z.array(z.number().int().positive()),
  sourceBooks: z.array(z.object({
    bookId: z.string().min(1),
    title: z.string().min(1),
    pages: z.array(z.number().int().positive()),
  })),
  preview: z.string(),
  primaryVisualKind: z.enum(["diagram", "chart", "table", "visual-reference"]).nullable(),
  primaryVisualSource: z.object({
    bookId: z.string().min(1),
    imageAssetId: z.string().min(1),
    page: z.number().int().nonnegative().nullable(),
    recognizedText: z.string().nullable(),
  }).nullable(),
});

export const mapListResponseSchema = z.object({ artifacts: z.array(mapArtifactSummarySchema) });

export const createMapFromMessageRequestSchema = z.object({
  messageId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
});

export const updateMapBlockRequestSchema = z.object({ id: z.string().min(1), content: z.unknown() });
export const updateMapRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  conciseExplanation: z.string().trim().max(20_000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  blocks: z.array(updateMapBlockRequestSchema).optional(),
}).refine((value) => value.title !== undefined || value.conciseExplanation !== undefined || value.tags !== undefined || value.blocks !== undefined, {
  message: "At least one Map field must be updated",
});

export const mapVersionSummarySchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
});
export const mapVersionHistoryResponseSchema = z.object({ versions: z.array(mapVersionSummarySchema) });
export const mapVersionDiffChangeSchema = z.object({
  order: z.number().int().nonnegative(),
  kind: mapBlockKindSchema,
  change: z.enum(["added", "removed", "modified", "unchanged"]),
  beforeContent: z.unknown().optional(),
  afterContent: z.unknown().optional(),
});
export const mapVersionDiffResponseSchema = z.object({
  fromVersion: z.number().int().positive(),
  toVersion: z.number().int().positive(),
  changes: z.array(mapVersionDiffChangeSchema),
});

export type GroundingKind = z.infer<typeof groundingKindSchema>;
export type GroundingStatus = z.infer<typeof groundingStatusSchema>;
export type MapBlockKind = z.infer<typeof mapBlockKindSchema>;
export type MapBlockSourceRef = z.infer<typeof mapBlockSourceRefSchema>;
export type MapBlock = z.infer<typeof mapBlockSchema>;
export type MapArtifact = z.infer<typeof mapArtifactSchema>;
export type MapSource = z.infer<typeof mapSourceSchema>;
export type MapArtifactDetail = z.infer<typeof mapArtifactDetailSchema>;
export type MapArtifactSummary = z.infer<typeof mapArtifactSummarySchema>;
export type MapListResponse = z.infer<typeof mapListResponseSchema>;
export type CreateMapFromMessageRequest = z.infer<typeof createMapFromMessageRequestSchema>;
export type UpdateMapRequest = z.infer<typeof updateMapRequestSchema>;
export type MapVersionSummary = z.infer<typeof mapVersionSummarySchema>;
export type MapVersionHistoryResponse = z.infer<typeof mapVersionHistoryResponseSchema>;
export type MapVersionDiffResponse = z.infer<typeof mapVersionDiffResponseSchema>;
