import type { FastifyPluginAsync } from "fastify";
import { codexStatusResponseSchema, codexUsageResponseSchema } from "@lensmap/shared";
import { z } from "zod";
import type { CodexAppServerClient } from "../codex/app-server-client.js";

interface CodexRouteOptions { codex: CodexAppServerClient; }
const usageQuerySchema = z.object({ threadId: z.string().min(1).optional() });

export const codexRoutes: FastifyPluginAsync<CodexRouteOptions> = async (app, options) => {
  app.get("/status", async () => {
    const binaryPath = options.codex.resolvedBinaryPath;
    if (!binaryPath) {
      return codexStatusResponseSchema.parse({
        available: false,
        ready: false,
        binaryPath: null,
        version: null,
        account: null,
        requiresOpenaiAuth: null,
        models: [],
        error: "Codex CLI was not found. Set CODEX_BIN or install ChatGPT/Codex.",
      });
    }

    try {
      const runtime = await options.codex.start();
      const [accountResponse, modelResponse] = await Promise.all([
        options.codex.getAccount(),
        options.codex.listModels(),
      ]);
      return codexStatusResponseSchema.parse({
        available: true,
        ready: true,
        binaryPath: runtime.binaryPath,
        version: runtime.version,
        account: accountResponse.account,
        requiresOpenaiAuth: accountResponse.requiresOpenaiAuth,
        models: modelResponse.data.filter((model) => !model.hidden).map((model) => ({
          id: model.id,
          displayName: model.displayName,
          description: model.description,
          isDefault: model.isDefault,
          defaultReasoningEffort: model.defaultReasoningEffort,
          inputModalities: model.inputModalities,
        })),
        error: null,
      });
    } catch (error: unknown) {
      return codexStatusResponseSchema.parse({
        available: true,
        ready: false,
        binaryPath,
        version: null,
        account: null,
        requiresOpenaiAuth: null,
        models: [],
        error: error instanceof Error ? error.message : "Codex app-server failed to start",
      });
    }
  });

  app.get("/usage", async (request, reply) => {
    const query = usageQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: "Invalid Codex usage query" });

    await options.codex.start();
    const rateLimits = await options.codex.getRateLimits().then((response) => {
      const snapshot = response.rateLimitsByLimitId?.codex ?? response.rateLimits;
      return {
        limitId: snapshot.limitId ?? null,
        limitName: snapshot.limitName ?? null,
        primary: snapshot.primary ?? null,
        secondary: snapshot.secondary ?? null,
      };
    }).catch(() => null);
    const cached = query.data.threadId ? options.codex.getThreadTokenUsage(query.data.threadId) : null;

    return codexUsageResponseSchema.parse({
      rateLimits,
      thread: cached ? {
        threadId: cached.threadId,
        turnId: cached.turnId,
        modelContextWindow: cached.tokenUsage.modelContextWindow ?? null,
        last: cached.tokenUsage.last,
        total: cached.tokenUsage.total,
      } : null,
      contextWindowFallback: options.codex.getModelContextWindowTokens(),
    });
  });
};
