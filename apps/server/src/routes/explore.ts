import type { FastifyPluginAsync } from "fastify";
import { exploreTurnStreamEventSchema, createExploreThreadRequestSchema, startExploreTurnRequestSchema } from "@lensmap/shared";
import { z } from "zod";
import type { ExploreService } from "../explore/explore-service.js";

interface ExploreRouteOptions { exploreService: ExploreService; }
interface WorkspaceParams { workspaceId: string; }

/** Expose persisted Workspace Explore plus a POST fetch stream for Codex turn deltas. */
export const exploreRoutes: FastifyPluginAsync<ExploreRouteOptions> = async (app, options) => {
  app.get<{ Params: WorkspaceParams }>("/", async (request, reply) => {
    const query = z.object({ threadId: z.string().min(1).optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: "Invalid Explore query" });
    try { return options.exploreService.getWorkspaceExplore(request.params.workspaceId, query.data.threadId); }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Explore could not be loaded";
      return reply.code(message === "Workspace not found" ? 404 : 500).send({ message });
    }
  });

  app.get<{ Params: WorkspaceParams }>("/threads", async (request, reply) => {
    try { return options.exploreService.listWorkspaceThreads(request.params.workspaceId); }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Explore threads could not be loaded";
      return reply.code(message === "Workspace not found" ? 404 : 500).send({ message });
    }
  });

  app.post<{ Params: WorkspaceParams }>("/threads", async (request, reply) => {
    const parsed = createExploreThreadRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: "Invalid Explore thread request", issues: parsed.error.issues });
    try { return reply.code(201).send(await options.exploreService.createWorkspaceThread(request.params.workspaceId, parsed.data)); }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Explore thread could not be created";
      return reply.code(message === "Workspace not found" ? 404 : 400).send({ message });
    }
  });

  app.post<{ Params: WorkspaceParams }>("/turns", async (request, reply) => {
    const parsed = startExploreTurnRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid Explore request", issues: parsed.error.issues });

    reply.hijack();
    reply.raw.statusCode = 200;
    const origin = request.headers.origin;
    if (origin === "http://127.0.0.1:5173" || origin === "http://localhost:5173") {
      reply.raw.setHeader("access-control-allow-origin", origin);
      reply.raw.setHeader("vary", "Origin");
    }
    reply.raw.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    reply.raw.setHeader("cache-control", "no-cache, no-transform");
    reply.raw.setHeader("x-content-type-options", "nosniff");
    reply.raw.flushHeaders();

    const writeEvent = (event: unknown) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      reply.raw.write(`${JSON.stringify(exploreTurnStreamEventSchema.parse(event))}\n`);
    };

    try {
      await options.exploreService.streamTurn({ workspaceId: request.params.workspaceId, input: parsed.data, onEvent: writeEvent });
    } catch (error: unknown) {
      writeEvent({ type: "error", message: error instanceof Error ? error.message : "Explore turn failed" });
    } finally {
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });

  app.post<{ Params: WorkspaceParams }>("/interrupt", async (request, reply) => {
    try { return { interrupted: await options.exploreService.interruptWorkspaceTurn(request.params.workspaceId) }; }
    catch (error: unknown) {
      return reply.code(500).send({ message: error instanceof Error ? error.message : "Explore turn could not be interrupted" });
    }
  });
};
