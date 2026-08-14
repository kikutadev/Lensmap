import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createMapFromMessageRequestSchema, updateMapRequestSchema } from "@lensmap/shared";
import type { MapService } from "../maps/map-service.js";

interface MapRouteOptions {
  mapService: MapService;
}

const listQuerySchema = z.object({ workspaceId: z.string().min(1) });
const artifactParamsSchema = z.object({ mapArtifactId: z.string().min(1) });
const versionParamsSchema = z.object({ mapArtifactId: z.string().min(1), version: z.coerce.number().int().positive() });
const diffQuerySchema = z.object({ from: z.coerce.number().int().positive(), to: z.coerce.number().int().positive() });

/** HTTP boundary for durable Map creation, reading, and version history. */
export const mapRoutes: FastifyPluginAsync<MapRouteOptions> = async (app, options) => {
  app.get("/", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: "workspaceId is required" });
    }
    try {
      return options.mapService.listByWorkspace(parsed.data.workspaceId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Map list failed";
      return reply.code(message === "Workspace not found" ? 404 : 500).send({ message });
    }
  });

  app.get("/:mapArtifactId", async (request, reply) => {
    const params = artifactParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid artifact id" });
    try {
      return options.mapService.getDetail(params.data.mapArtifactId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Map read failed";
      return reply.code(message === "Map artifact not found" ? 404 : 500).send({ message });
    }
  });

  app.patch("/:mapArtifactId", async (request, reply) => {
    const params = artifactParamsSchema.safeParse(request.params);
    const body = updateMapRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ message: "Invalid Map update" });
    try {
      return options.mapService.update(params.data.mapArtifactId, body.data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Map update failed";
      return reply.code(message.includes("not found") ? 404 : 500).send({ message });
    }
  });

  app.get("/:mapArtifactId/versions", async (request, reply) => {
    const params = artifactParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid artifact id" });
    try { return options.mapService.listVersions(params.data.mapArtifactId); }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Map versions failed";
      return reply.code(message.includes("not found") ? 404 : 500).send({ message });
    }
  });

  app.get("/:mapArtifactId/versions/:version", async (request, reply) => {
    const params = versionParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid Map version" });
    try { return options.mapService.getVersionDetail(params.data.mapArtifactId, params.data.version); }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Map version failed";
      return reply.code(message.includes("not found") ? 404 : 500).send({ message });
    }
  });

  app.get("/:mapArtifactId/diff", async (request, reply) => {
    const params = artifactParamsSchema.safeParse(request.params);
    const query = diffQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ message: "Invalid Map diff" });
    try { return options.mapService.diffVersions(params.data.mapArtifactId, query.data.from, query.data.to); }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Map diff failed";
      return reply.code(message.includes("not found") ? 404 : 500).send({ message });
    }
  });

  app.post("/from-message", async (request, reply) => {
    const parsed = createMapFromMessageRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid Map request", issues: parsed.error.issues });
    }
    try {
      return reply.code(201).send(options.mapService.createFromMessage(parsed.data));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Map creation failed";
      const status = message.includes("not found") ? 404 : message.startsWith("Only") || message.startsWith("Empty") ? 409 : 500;
      return reply.code(status).send({ message });
    }
  });
};
