import { z } from "zod";
import { bookSchema } from "./book.js";
import { sourceAnchorSchema } from "./source-anchor.js";

export const readerWorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  books: z.array(bookSchema),
  sources: z.array(sourceAnchorSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const readerWorkspaceSummarySchema = readerWorkspaceSchema.omit({ sources: true }).extend({
  sourceCount: z.number().int().nonnegative(),
});

export const workspaceListResponseSchema = z.object({
  workspaces: z.array(readerWorkspaceSummarySchema),
});

export const createWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  bookId: z.string().min(1).optional(),
});

export const updateWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const addWorkspaceBookRequestSchema = z.object({
  bookId: z.string().min(1),
});

export const addWorkspaceSourceRequestSchema = z.object({
  sourceAnchorId: z.string().min(1),
});

export type ReaderWorkspace = z.infer<typeof readerWorkspaceSchema>;
export type ReaderWorkspaceSummary = z.infer<typeof readerWorkspaceSummarySchema>;
export type WorkspaceListResponse = z.infer<typeof workspaceListResponseSchema>;
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;
export type AddWorkspaceBookRequest = z.infer<typeof addWorkspaceBookRequestSchema>;
export type AddWorkspaceSourceRequest = z.infer<typeof addWorkspaceSourceRequestSchema>;
