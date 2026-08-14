import { z } from "zod";

export const configReadResponseSchema = z.object({
  config: z.record(z.string(), z.unknown()),
}).passthrough();

export const initializeResponseSchema = z.object({
  userAgent: z.string(),
  codexHome: z.string(),
  platformFamily: z.string(),
  platformOs: z.string(),
});

const accountSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("apiKey") }),
  z.object({ type: z.literal("chatgpt"), email: z.string().nullable(), planType: z.string() }),
  z.object({ type: z.literal("amazonBedrock"), usesCodexManagedCredentials: z.boolean() }),
]);

export const getAccountResponseSchema = z.object({
  account: accountSchema.nullable(),
  requiresOpenaiAuth: z.boolean(),
});

export const modelListResponseSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    displayName: z.string(),
    description: z.string(),
    hidden: z.boolean(),
    inputModalities: z.array(z.enum(["text", "image", "audio"])).default(["text"]),
    defaultReasoningEffort: z.string(),
    isDefault: z.boolean(),
  }).passthrough()),
  nextCursor: z.string().nullable(),
});

export const rateLimitWindowSchema = z.object({
  usedPercent: z.number().int(),
  resetsAt: z.number().int().nullable(),
  windowDurationMins: z.number().int().nullable(),
});

export const rateLimitSnapshotSchema = z.object({
  limitId: z.string().nullable().optional(),
  limitName: z.string().nullable().optional(),
  primary: rateLimitWindowSchema.nullable().optional(),
  secondary: rateLimitWindowSchema.nullable().optional(),
}).passthrough();

export const getAccountRateLimitsResponseSchema = z.object({
  rateLimits: rateLimitSnapshotSchema,
  rateLimitsByLimitId: z.record(z.string(), rateLimitSnapshotSchema).nullable().optional(),
}).passthrough();

export const tokenUsageBreakdownSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cacheWriteInputTokens: z.number().int().nonnegative().default(0),
});

export const threadTokenUsageSchema = z.object({
  last: tokenUsageBreakdownSchema,
  total: tokenUsageBreakdownSchema,
  modelContextWindow: z.number().int().positive().nullable().optional(),
});

export const threadTokenUsageUpdatedParamsSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  tokenUsage: threadTokenUsageSchema,
});

const threadSummarySchema = z.object({
  id: z.string(),
}).passthrough();

export const threadStartResponseSchema = z.object({
  thread: threadSummarySchema,
  model: z.string(),
  modelProvider: z.string(),
}).passthrough();

export const threadResumeResponseSchema = threadStartResponseSchema;

export const turnStartResponseSchema = z.object({
  turn: z.object({
    id: z.string(),
    status: z.string(),
  }).passthrough(),
});

export const turnInterruptResponseSchema = z.object({}).passthrough();

export const serverNotificationEnvelopeSchema = z.object({
  method: z.string(),
  params: z.unknown(),
  emittedAtMs: z.number().optional(),
});

export const dynamicToolCallParamsSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  callId: z.string(),
  namespace: z.string().nullable(),
  tool: z.string(),
  arguments: z.unknown(),
});

export const agentMessageDeltaParamsSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  delta: z.string(),
});

export const turnCompletedParamsSchema = z.object({
  threadId: z.string(),
  turn: z.object({
    id: z.string(),
    status: z.string(),
    error: z.unknown().nullable().optional(),
  }).passthrough(),
});

export type ConfigReadResponse = z.infer<typeof configReadResponseSchema>;
export type InitializeResponse = z.infer<typeof initializeResponseSchema>;
export type GetAccountResponse = z.infer<typeof getAccountResponseSchema>;
export type ModelListResponse = z.infer<typeof modelListResponseSchema>;
export type GetAccountRateLimitsResponse = z.infer<typeof getAccountRateLimitsResponseSchema>;
export type ThreadTokenUsage = z.infer<typeof threadTokenUsageSchema>;
export type ThreadTokenUsageUpdatedParams = z.infer<typeof threadTokenUsageUpdatedParamsSchema>;
export type ThreadStartResponse = z.infer<typeof threadStartResponseSchema>;
export type ThreadResumeResponse = z.infer<typeof threadResumeResponseSchema>;
export type TurnStartResponse = z.infer<typeof turnStartResponseSchema>;
export type ServerNotificationEnvelope = z.infer<typeof serverNotificationEnvelopeSchema>;
export type DynamicToolCallParams = z.infer<typeof dynamicToolCallParamsSchema>;
