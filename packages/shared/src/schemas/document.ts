import { z } from "zod";
import { pdfRectSchema } from "./source-anchor.js";

export const documentBlockKindSchema = z.enum([
  "heading",
  "paragraph",
  "code",
  "table-like",
]);

export const documentPageSchema = z.object({
  id: z.string().min(1),
  bookId: z.string().min(1),
  pageIndex: z.number().int().nonnegative(),
  printedPageLabel: z.string().nullable(),
  textRaw: z.string(),
  textNormalized: z.string(),
  createdAt: z.string().datetime(),
});

export const documentBlockSchema = z.object({
  id: z.string().min(1),
  bookId: z.string().min(1),
  pageIndex: z.number().int().nonnegative(),
  blockOrder: z.number().int().nonnegative(),
  kind: documentBlockKindSchema,
  textRaw: z.string().min(1),
  textNormalized: z.string().min(1),
  rects: z.array(pdfRectSchema),
  createdAt: z.string().datetime(),
});

export const documentIndexStatusSchema = z.object({
  bookId: z.string().min(1),
  status: z.enum(["not-indexed", "indexing", "indexed", "error"]),
  pageCount: z.number().int().nonnegative().nullable(),
  blockCount: z.number().int().nonnegative(),
  indexedAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
});

export const documentOutlineItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  pageIndex: z.number().int().nonnegative(),
  depth: z.number().int().nonnegative(),
  order: z.number().int().nonnegative(),
});

export const documentOutlineResponseSchema = z.object({
  items: z.array(documentOutlineItemSchema),
});

export const bookSearchHitSchema = z.object({
  block: documentBlockSchema,
  rank: z.number(),
  snippet: z.string(),
});

export const bookSearchResponseSchema = z.object({
  query: z.string(),
  hits: z.array(bookSearchHitSchema),
});

export type DocumentBlockKind = z.infer<typeof documentBlockKindSchema>;
export type DocumentPage = z.infer<typeof documentPageSchema>;
export type DocumentBlock = z.infer<typeof documentBlockSchema>;
export type DocumentIndexStatus = z.infer<typeof documentIndexStatusSchema>;
export type DocumentOutlineItem = z.infer<typeof documentOutlineItemSchema>;
export type DocumentOutlineResponse = z.infer<typeof documentOutlineResponseSchema>;
export type BookSearchHit = z.infer<typeof bookSearchHitSchema>;
export type BookSearchResponse = z.infer<typeof bookSearchResponseSchema>;
