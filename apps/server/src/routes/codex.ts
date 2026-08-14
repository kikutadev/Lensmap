import type { FastifyPluginAsync } from "fastify";
import {
  codexLoginResponseSchema,
  codexStatusResponseSchema,
} from "@deep-reader/shared";
import type { CodexAppServerClient } from "../codex/app-server-client.js";

interface CodexRouteOptions {
  codex: CodexAppServerClient;
}

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
        models: modelResponse.data
          .filter((model) => !model.hidden)
          .map((model) => ({
            id: model.id,
            displayName: model.displayName,
            description: model.description,
            isDefault: model.isDefault,
            defaultReasoningEffort: model.defaultReasoningEffort,
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

  app.post("/login/chatgpt", async (_request, reply) => {
    try {
      const result = await options.codex.startChatGptLogin();
      if (result.type !== "chatgpt") {
        return reply.code(500).send({ message: `Unexpected login response: ${result.type}` });
      }
      return codexLoginResponseSchema.parse({
        loginId: result.loginId,
        authUrl: result.authUrl,
      });
    } catch (error: unknown) {
      return reply.code(500).send({
        message: error instanceof Error ? error.message : "ChatGPT login could not be started",
      });
    }
  });
};
