import { z } from "zod";
import { sourceOriginSchema } from "./source-anchor.js";

export const exploreMessageStatusSchema = z.enum(["streaming", "completed", "error", "interrupted"]);
export const exploreMessageRoleSchema = z.enum(["user", "assistant"]);

export const exploreMessageSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    label: z.string().regex(/^S\d+$/),
    sourceAnchorId: z.string().min(1),
    bookId: z.string().min(1),
    bookTitle: z.string().min(1),
    pageStart: z.number().int().nonnegative(),
    pageEnd: z.number().int().nonnegative(),
    printedPageLabelStart: z.string().nullable(),
    printedPageLabelEnd: z.string().nullable(),
    quoteRaw: z.string().min(1),
    includedText: z.string(),
    truncated: z.boolean(),
    origin: sourceOriginSchema,
  }),
  z.object({
    kind: z.literal("visual"),
    label: z.string().regex(/^S\d+$/),
    sourceAnchorId: z.string().min(1),
    bookId: z.string().min(1),
    bookTitle: z.string().min(1),
    imageAssetId: z.string().min(1),
    locationStatus: z.enum(["unresolved", "page-resolved", "rect-resolved"]),
    page: z.number().int().nonnegative().nullable(),
    recognizedText: z.string().nullable(),
    includedText: z.string(),
    truncated: z.boolean(),
    origin: sourceOriginSchema,
  }),
]);

export const exploreRetrievalEventSchema = z.object({
  id: z.string().min(1),
  toolName: z.string().min(1),
  arguments: z.unknown(),
  resultSummary: z.unknown(),
  createdAt: z.string().datetime(),
});

export const exploreMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  role: exploreMessageRoleSchema,
  content: z.string(),
  status: exploreMessageStatusSchema,
  codexTurnId: z.string().nullable(),
  sources: z.array(exploreMessageSourceSchema),
  invalidCitationLabels: z.array(z.string().regex(/^S\d+$/)).default([]),
  retrievalEvents: z.array(exploreRetrievalEventSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const exploreThreadSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  codexThreadId: z.string().nullable(),
  model: z.string().min(1),
  title: z.string().min(1),
  conversationSummary: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(exploreMessageSchema),
});

export const workspaceExploreResponseSchema = z.object({
  thread: exploreThreadSchema.nullable(),
});

export const exploreThreadSummarySchema = exploreThreadSchema.omit({ messages: true, conversationSummary: true }).extend({
  messageCount: z.number().int().nonnegative(),
});

export const workspaceExploreThreadsResponseSchema = z.object({
  threads: z.array(exploreThreadSummarySchema),
});

export const createExploreThreadRequestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  model: z.string().min(1).optional(),
});

export const startExploreTurnRequestSchema = z.object({
  question: z.string().trim().min(1).max(20_000),
  sourceIds: z.array(z.string().min(1)).min(1),
  model: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
});

const exploreTurnStartedEventSchema = z.object({
  type: z.literal("turn-started"),
  threadId: z.string().min(1),
  codexThreadId: z.string().min(1),
  codexTurnId: z.string().min(1),
  userMessage: exploreMessageSchema,
  assistantMessage: exploreMessageSchema,
});

const exploreTurnDeltaEventSchema = z.object({
  type: z.literal("delta"),
  messageId: z.string().min(1),
  delta: z.string(),
});

const exploreTurnCompletedEventSchema = z.object({
  type: z.literal("completed"),
  message: exploreMessageSchema,
});

const exploreTurnErrorEventSchema = z.object({
  type: z.literal("error"),
  messageId: z.string().optional(),
  message: z.string().min(1),
});

export const exploreTurnStreamEventSchema = z.discriminatedUnion("type", [
  exploreTurnStartedEventSchema,
  exploreTurnDeltaEventSchema,
  exploreTurnCompletedEventSchema,
  exploreTurnErrorEventSchema,
]);

export type ExploreMessageStatus = z.infer<typeof exploreMessageStatusSchema>;
export type ExploreMessageRole = z.infer<typeof exploreMessageRoleSchema>;
export type ExploreMessageSource = z.infer<typeof exploreMessageSourceSchema>;
export type ExploreRetrievalEvent = z.infer<typeof exploreRetrievalEventSchema>;
export type ExploreMessage = z.infer<typeof exploreMessageSchema>;
export type ExploreThread = z.infer<typeof exploreThreadSchema>;
export type ExploreThreadSummary = z.infer<typeof exploreThreadSummarySchema>;
export type WorkspaceExploreResponse = z.infer<typeof workspaceExploreResponseSchema>;
export type WorkspaceExploreThreadsResponse = z.infer<typeof workspaceExploreThreadsResponseSchema>;
export type CreateExploreThreadRequest = z.infer<typeof createExploreThreadRequestSchema>;
export type StartExploreTurnRequest = z.infer<typeof startExploreTurnRequestSchema>;
export type ExploreTurnStreamEvent = z.infer<typeof exploreTurnStreamEventSchema>;
