import { z } from "zod";
import { sourceOriginSchema } from "./source-anchor.js";

export const chatMessageStatusSchema = z.enum(["streaming", "completed", "error", "interrupted"]);
export const chatMessageRoleSchema = z.enum(["user", "assistant"]);

export const chatMessageSourceSchema = z.object({
  label: z.string().regex(/^S\d+$/),
  sourceAnchorId: z.string().min(1),
  bookId: z.string().min(1),
  pageStart: z.number().int().nonnegative(),
  pageEnd: z.number().int().nonnegative(),
  printedPageLabelStart: z.string().nullable(),
  printedPageLabelEnd: z.string().nullable(),
  quoteRaw: z.string().min(1),
  includedText: z.string(),
  truncated: z.boolean(),
  origin: sourceOriginSchema,
});


export const chatRetrievalEventSchema = z.object({
  id: z.string().min(1),
  toolName: z.string().min(1),
  arguments: z.unknown(),
  resultSummary: z.unknown(),
  createdAt: z.string().datetime(),
});

export const chatMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  role: chatMessageRoleSchema,
  content: z.string(),
  status: chatMessageStatusSchema,
  codexTurnId: z.string().nullable(),
  sources: z.array(chatMessageSourceSchema),
  invalidCitationLabels: z.array(z.string().regex(/^S\d+$/)).default([]),
  retrievalEvents: z.array(chatRetrievalEventSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const chatThreadSchema = z.object({
  id: z.string().min(1),
  bookId: z.string().min(1),
  codexThreadId: z.string().nullable(),
  model: z.string().min(1),
  title: z.string().min(1),
  conversationSummary: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(chatMessageSchema),
});

export const bookChatResponseSchema = z.object({
  thread: chatThreadSchema.nullable(),
});

export const chatThreadSummarySchema = chatThreadSchema.omit({ messages: true, conversationSummary: true }).extend({
  messageCount: z.number().int().nonnegative(),
});

export const bookChatThreadsResponseSchema = z.object({
  threads: z.array(chatThreadSummarySchema),
});

export const createChatThreadRequestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  model: z.string().min(1).optional(),
});

export const startChatTurnRequestSchema = z.object({
  question: z.string().trim().min(1).max(20_000),
  sourceIds: z.array(z.string().min(1)).min(1),
  model: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
});

const chatTurnStartedEventSchema = z.object({
  type: z.literal("turn-started"),
  threadId: z.string().min(1),
  codexThreadId: z.string().min(1),
  codexTurnId: z.string().min(1),
  userMessage: chatMessageSchema,
  assistantMessage: chatMessageSchema,
});

const chatTurnDeltaEventSchema = z.object({
  type: z.literal("delta"),
  messageId: z.string().min(1),
  delta: z.string(),
});

const chatTurnCompletedEventSchema = z.object({
  type: z.literal("completed"),
  message: chatMessageSchema,
});

const chatTurnErrorEventSchema = z.object({
  type: z.literal("error"),
  messageId: z.string().optional(),
  message: z.string().min(1),
});

export const chatTurnStreamEventSchema = z.discriminatedUnion("type", [
  chatTurnStartedEventSchema,
  chatTurnDeltaEventSchema,
  chatTurnCompletedEventSchema,
  chatTurnErrorEventSchema,
]);

export type ChatMessageStatus = z.infer<typeof chatMessageStatusSchema>;
export type ChatMessageRole = z.infer<typeof chatMessageRoleSchema>;
export type ChatMessageSource = z.infer<typeof chatMessageSourceSchema>;
export type ChatRetrievalEvent = z.infer<typeof chatRetrievalEventSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatThread = z.infer<typeof chatThreadSchema>;
export type ChatThreadSummary = z.infer<typeof chatThreadSummarySchema>;
export type BookChatResponse = z.infer<typeof bookChatResponseSchema>;
export type BookChatThreadsResponse = z.infer<typeof bookChatThreadsResponseSchema>;
export type CreateChatThreadRequest = z.infer<typeof createChatThreadRequestSchema>;
export type StartChatTurnRequest = z.infer<typeof startChatTurnRequestSchema>;
export type ChatTurnStreamEvent = z.infer<typeof chatTurnStreamEventSchema>;
