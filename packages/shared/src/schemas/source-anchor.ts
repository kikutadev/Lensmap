import { z } from "zod";

export const pdfRectSchema = z.object({
  pageIndex: z.number().int().nonnegative(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});

export const normalizedRectSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1),
}).refine((rect) => rect.x + rect.width <= 1.000001 && rect.y + rect.height <= 1.000001, {
  message: "Normalized rectangle must remain within 0..1 bounds",
});

export const sourceOriginSchema = z.enum(["user-selection", "ai-expansion"]);

export const textSourceAnchorSchema = z.object({
  kind: z.literal("text"),
  id: z.string().min(1),
  bookId: z.string().min(1),
  pageStart: z.number().int().nonnegative(),
  pageEnd: z.number().int().nonnegative(),
  printedPageLabelStart: z.string().optional(),
  printedPageLabelEnd: z.string().optional(),
  quoteRaw: z.string().min(1),
  quoteNormalized: z.string().min(1),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  rects: z.array(pdfRectSchema).min(1),
  textHash: z.string().min(1),
  origin: sourceOriginSchema,
  documentNodeIds: z.array(z.string()),
  createdAt: z.string().datetime(),
});

export const visualLocationStatusSchema = z.enum(["unresolved", "page-resolved", "rect-resolved"]);

export const visualSourceAnchorSchema = z.object({
  kind: z.literal("visual"),
  id: z.string().min(1),
  bookId: z.string().min(1),
  imageAssetId: z.string().min(1),
  captureImageWidthPx: z.number().int().positive(),
  captureImageHeightPx: z.number().int().positive(),
  captureRectNormalized: normalizedRectSchema,
  locationStatus: visualLocationStatusSchema,
  page: z.number().int().nonnegative().optional(),
  pageRectNormalized: normalizedRectSchema.optional(),
  locationConfidence: z.number().finite().min(0).max(1).optional(),
  recognizedText: z.string().trim().min(1).optional(),
  ocrConfidence: z.number().finite().min(0).max(1).optional(),
  origin: sourceOriginSchema,
  documentNodeIds: z.array(z.string()),
  createdAt: z.string().datetime(),
}).superRefine((source, context) => {
  if (source.locationStatus !== "unresolved" && source.page === undefined) {
    context.addIssue({ code: "custom", path: ["page"], message: "Resolved visual locations require a page" });
  }
  if (source.locationStatus === "rect-resolved" && !source.pageRectNormalized) {
    context.addIssue({ code: "custom", path: ["pageRectNormalized"], message: "rect-resolved requires pageRectNormalized" });
  }
});

export const sourceAnchorSchema = z.discriminatedUnion("kind", [
  textSourceAnchorSchema,
  visualSourceAnchorSchema,
]);

export const createSourceAnchorRequestSchema = textSourceAnchorSchema
  .omit({ id: true, bookId: true, textHash: true, createdAt: true, kind: true })
  .extend({
    kind: z.literal("text").default("text"),
    origin: z.literal("user-selection").default("user-selection"),
    documentNodeIds: z.array(z.string()).default([]),
  });

export const createVisualSourceRequestSchema = z.object({
  captureImageWidthPx: z.number().int().positive(),
  captureImageHeightPx: z.number().int().positive(),
  captureRectNormalized: normalizedRectSchema,
  locationStatus: visualLocationStatusSchema.default("unresolved"),
  page: z.number().int().nonnegative().optional(),
  pageRectNormalized: normalizedRectSchema.optional(),
  locationConfidence: z.number().finite().min(0).max(1).optional(),
  recognizedText: z.string().trim().min(1).optional(),
  ocrConfidence: z.number().finite().min(0).max(1).optional(),
  documentNodeIds: z.array(z.string()).default([]),
}).superRefine((source, context) => {
  if (source.locationStatus !== "unresolved" && source.page === undefined) {
    context.addIssue({ code: "custom", path: ["page"], message: "Resolved visual locations require a page" });
  }
  if (source.locationStatus === "rect-resolved" && !source.pageRectNormalized) {
    context.addIssue({ code: "custom", path: ["pageRectNormalized"], message: "rect-resolved requires pageRectNormalized" });
  }
});

export const resolveSelectionRequestSchema = z.object({
  quoteRaw: z.string().trim().min(1).max(100_000),
});

export const selectionResolutionCandidateSchema = z.object({
  pageStart: z.number().int().nonnegative(),
  pageEnd: z.number().int().nonnegative(),
  printedPageLabelStart: z.string().optional(),
  printedPageLabelEnd: z.string().optional(),
  quoteRaw: z.string().min(1),
  quoteNormalized: z.string().min(1),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  rects: z.array(pdfRectSchema).min(1),
  documentNodeIds: z.array(z.string()).min(1),
  confidence: z.enum(["exact-page", "boundary-range"]),
});

export const resolveSelectionResponseSchema = z.object({
  quoteNormalized: z.string().min(1),
  candidates: z.array(selectionResolutionCandidateSchema),
});

export type PdfRect = z.infer<typeof pdfRectSchema>;
export type NormalizedRect = z.infer<typeof normalizedRectSchema>;
export type SourceOrigin = z.infer<typeof sourceOriginSchema>;
export type TextSourceAnchor = z.infer<typeof textSourceAnchorSchema>;
export type VisualSourceAnchor = z.infer<typeof visualSourceAnchorSchema>;
export type SourceAnchor = z.infer<typeof sourceAnchorSchema>;
export type CreateSourceAnchorRequest = z.input<typeof createSourceAnchorRequestSchema>;
export type CreateVisualSourceRequest = z.input<typeof createVisualSourceRequestSchema>;
export type ResolveSelectionRequest = z.infer<typeof resolveSelectionRequestSchema>;
export type SelectionResolutionCandidate = z.infer<typeof selectionResolutionCandidateSchema>;
export type ResolveSelectionResponse = z.infer<typeof resolveSelectionResponseSchema>;
