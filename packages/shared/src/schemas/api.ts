import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("lensmap-server"),
  version: z.string(),
  capabilityRequired: z.boolean().optional(),
});

export const codexInputModalitySchema = z.enum(["text", "image", "audio"]);

export const codexModelSummarySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  isDefault: z.boolean(),
  defaultReasoningEffort: z.string(),
  inputModalities: z.array(codexInputModalitySchema).default(["text"]),
});

export const codexAccountSummarySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("chatgpt"),
    email: z.string().nullable(),
    planType: z.string(),
  }),
  z.object({ type: z.literal("apiKey") }),
  z.object({
    type: z.literal("amazonBedrock"),
    usesCodexManagedCredentials: z.boolean(),
  }),
]);

export const codexStatusResponseSchema = z.object({
  available: z.boolean(),
  ready: z.boolean(),
  binaryPath: z.string().nullable(),
  version: z.string().nullable(),
  account: codexAccountSummarySchema.nullable(),
  requiresOpenaiAuth: z.boolean().nullable(),
  models: z.array(codexModelSummarySchema),
  error: z.string().nullable(),
});

export const codexRateLimitWindowSchema = z.object({
  usedPercent: z.number().int().min(0).max(100),
  resetsAt: z.number().int().nullable(),
  windowDurationMins: z.number().int().positive().nullable(),
});

export const codexRateLimitSummarySchema = z.object({
  limitId: z.string().nullable(),
  limitName: z.string().nullable(),
  primary: codexRateLimitWindowSchema.nullable(),
  secondary: codexRateLimitWindowSchema.nullable(),
});

export const codexTokenUsageBreakdownSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cacheWriteInputTokens: z.number().int().nonnegative().default(0),
});

export const codexThreadTokenUsageSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  modelContextWindow: z.number().int().positive().nullable(),
  last: codexTokenUsageBreakdownSchema,
  total: codexTokenUsageBreakdownSchema,
});

export const codexUsageResponseSchema = z.object({
  rateLimits: codexRateLimitSummarySchema.nullable(),
  thread: codexThreadTokenUsageSchema.nullable(),
  contextWindowFallback: z.number().int().positive().nullable(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type CodexInputModality = z.infer<typeof codexInputModalitySchema>;
export type CodexModelSummary = z.infer<typeof codexModelSummarySchema>;
export type CodexAccountSummary = z.infer<typeof codexAccountSummarySchema>;
export type CodexStatusResponse = z.infer<typeof codexStatusResponseSchema>;
export type CodexRateLimitWindow = z.infer<typeof codexRateLimitWindowSchema>;
export type CodexRateLimitSummary = z.infer<typeof codexRateLimitSummarySchema>;
export type CodexTokenUsageBreakdown = z.infer<typeof codexTokenUsageBreakdownSchema>;
export type CodexThreadTokenUsage = z.infer<typeof codexThreadTokenUsageSchema>;
export type CodexUsageResponse = z.infer<typeof codexUsageResponseSchema>;
