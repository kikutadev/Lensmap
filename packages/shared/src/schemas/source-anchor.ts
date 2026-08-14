import { z } from "zod";

export const pdfRectSchema = z.object({
  pageIndex: z.number().int().nonnegative(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});

export const sourceOriginSchema = z.enum(["user-selection", "ai-expansion"]);

export const sourceAnchorSchema = z.object({
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

export const createSourceAnchorRequestSchema = sourceAnchorSchema
  .omit({
    id: true,
    bookId: true,
    textHash: true,
    createdAt: true,
  })
  .extend({
    origin: z.literal("user-selection").default("user-selection"),
    documentNodeIds: z.array(z.string()).default([]),
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
export type SourceOrigin = z.infer<typeof sourceOriginSchema>;
export type SourceAnchor = z.infer<typeof sourceAnchorSchema>;
export type CreateSourceAnchorRequest = z.input<typeof createSourceAnchorRequestSchema>;
export type ResolveSelectionRequest = z.infer<typeof resolveSelectionRequestSchema>;
export type SelectionResolutionCandidate = z.infer<typeof selectionResolutionCandidateSchema>;
export type ResolveSelectionResponse = z.infer<typeof resolveSelectionResponseSchema>;
