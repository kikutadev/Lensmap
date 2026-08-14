import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("deep-reader-server"),
  version: z.string(),
  capabilityRequired: z.boolean().optional(),
});

export const codexModelSummarySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  isDefault: z.boolean(),
  defaultReasoningEffort: z.string(),
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

export const codexLoginResponseSchema = z.object({
  loginId: z.string(),
  authUrl: z.string().url(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type CodexModelSummary = z.infer<typeof codexModelSummarySchema>;
export type CodexAccountSummary = z.infer<typeof codexAccountSummarySchema>;
export type CodexStatusResponse = z.infer<typeof codexStatusResponseSchema>;
export type CodexLoginResponse = z.infer<typeof codexLoginResponseSchema>;
