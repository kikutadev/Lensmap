import { z } from "zod";
import { sourceOriginSchema } from "./source-anchor.js";

export const groundingKindSchema = z.enum([
  "source-backed",
  "derived",
  "ai-explanation",
]);

export const groundingStatusSchema = z.enum([
  "references-checked",
  "claim-verified",
  "modified",
  "needs-review",
]);

export const artifactBlockKindSchema = z.enum([
  "markdown",
  "table",
  "diagram",
  "chart",
]);

export const artifactBlockSourceRefSchema = z.object({
  label: z.string().regex(/^S\d+$/),
  sourceAnchorId: z.string().min(1),
});

export const artifactBlockSchema = z.object({
  id: z.string().min(1),
  kind: artifactBlockKindSchema,
  order: z.number().int().nonnegative(),
  content: z.unknown(),
  sourceAnchorIds: z.array(z.string()),
  sourceRefs: z.array(artifactBlockSourceRefSchema),
  groundingKind: groundingKindSchema,
  groundingStatus: groundingStatusSchema,
});

export const insightArtifactKindSchema = z.enum([
  "note",
  "report",
  "table",
  "diagram",
  "chart",
]);

export const insightArtifactSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: insightArtifactKindSchema,
  primaryBookId: z.string().min(1).nullable(),
  sourceAnchorIds: z.array(z.string()),
  originTurnIds: z.array(z.string()),
  createdBy: z.enum(["ai", "user", "mixed"]),
  tags: z.array(z.string().min(1).max(40)),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().positive(),
  blocks: z.array(artifactBlockSchema),
});

export const insightSourceSchema = z.object({
  sourceAnchorId: z.string().min(1),
  bookId: z.string().min(1),
  pageStart: z.number().int().nonnegative(),
  pageEnd: z.number().int().nonnegative(),
  printedPageLabelStart: z.string().nullable(),
  printedPageLabelEnd: z.string().nullable(),
  quoteRaw: z.string().min(1),
  origin: sourceOriginSchema,
});

export const insightArtifactDetailSchema = z.object({
  artifact: insightArtifactSchema,
  sources: z.array(insightSourceSchema),
});

export const insightArtifactSummarySchema = insightArtifactSchema
  .omit({ blocks: true, sourceAnchorIds: true })
  .extend({
    sourceCount: z.number().int().nonnegative(),
  });

export const insightListResponseSchema = z.object({
  artifacts: z.array(insightArtifactSummarySchema),
});

export const createInsightFromMessageRequestSchema = z.object({
  messageId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
});

export const updateInsightBlockRequestSchema = z.object({
  id: z.string().min(1),
  content: z.unknown(),
});

export const updateInsightRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  blocks: z.array(updateInsightBlockRequestSchema).optional(),
}).refine((value) => value.title !== undefined || value.tags !== undefined || value.blocks !== undefined, {
  message: "At least one Insight field must be updated",
});

export const insightVersionSummarySchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
});

export const insightVersionHistoryResponseSchema = z.object({
  versions: z.array(insightVersionSummarySchema),
});

export const insightVersionDiffChangeSchema = z.object({
  order: z.number().int().nonnegative(),
  kind: artifactBlockKindSchema,
  change: z.enum(["added", "removed", "modified", "unchanged"]),
  beforeContent: z.unknown().optional(),
  afterContent: z.unknown().optional(),
});

export const insightVersionDiffResponseSchema = z.object({
  fromVersion: z.number().int().positive(),
  toVersion: z.number().int().positive(),
  changes: z.array(insightVersionDiffChangeSchema),
});

export type GroundingKind = z.infer<typeof groundingKindSchema>;
export type GroundingStatus = z.infer<typeof groundingStatusSchema>;
export type ArtifactBlockSourceRef = z.infer<typeof artifactBlockSourceRefSchema>;
export type ArtifactBlock = z.infer<typeof artifactBlockSchema>;
export type InsightArtifact = z.infer<typeof insightArtifactSchema>;
export type InsightSource = z.infer<typeof insightSourceSchema>;
export type InsightArtifactDetail = z.infer<typeof insightArtifactDetailSchema>;
export type InsightArtifactSummary = z.infer<typeof insightArtifactSummarySchema>;
export type InsightListResponse = z.infer<typeof insightListResponseSchema>;
export type CreateInsightFromMessageRequest = z.infer<typeof createInsightFromMessageRequestSchema>;
export type UpdateInsightRequest = z.infer<typeof updateInsightRequestSchema>;
export type InsightVersionSummary = z.infer<typeof insightVersionSummarySchema>;
export type InsightVersionHistoryResponse = z.infer<typeof insightVersionHistoryResponseSchema>;
export type InsightVersionDiffResponse = z.infer<typeof insightVersionDiffResponseSchema>;
