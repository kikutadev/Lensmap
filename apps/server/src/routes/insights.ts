import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createInsightFromMessageRequestSchema, updateInsightRequestSchema } from "@deep-reader/shared";
import type { InsightService } from "../insights/insight-service.js";

interface InsightRouteOptions {
  insightService: InsightService;
}

const listQuerySchema = z.object({ bookId: z.string().min(1) });
const artifactParamsSchema = z.object({ artifactId: z.string().min(1) });
const versionParamsSchema = z.object({ artifactId: z.string().min(1), version: z.coerce.number().int().positive() });
const diffQuerySchema = z.object({ from: z.coerce.number().int().positive(), to: z.coerce.number().int().positive() });

/** HTTP boundary for durable Insight creation and reading. */
export const insightRoutes: FastifyPluginAsync<InsightRouteOptions> = async (app, options) => {
  app.get("/", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: "bookId is required" });
    }
    try {
      return options.insightService.listByBook(parsed.data.bookId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Insight list failed";
      return reply.code(message === "Book not found" ? 404 : 500).send({ message });
    }
  });

  app.get("/:artifactId", async (request, reply) => {
    const params = artifactParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid artifact id" });
    try {
      return options.insightService.getDetail(params.data.artifactId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Insight read failed";
      return reply.code(message === "Insight artifact not found" ? 404 : 500).send({ message });
    }
  });

  app.patch("/:artifactId", async (request, reply) => {
    const params = artifactParamsSchema.safeParse(request.params);
    const body = updateInsightRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ message: "Invalid Insight update" });
    try {
      return options.insightService.update(params.data.artifactId, body.data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Insight update failed";
      return reply.code(message.includes("not found") ? 404 : 500).send({ message });
    }
  });

  app.get("/:artifactId/versions", async (request, reply) => {
    const params = artifactParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid artifact id" });
    try { return options.insightService.listVersions(params.data.artifactId); }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Insight versions failed";
      return reply.code(message.includes("not found") ? 404 : 500).send({ message });
    }
  });

  app.get("/:artifactId/versions/:version", async (request, reply) => {
    const params = versionParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid Insight version" });
    try { return options.insightService.getVersionDetail(params.data.artifactId, params.data.version); }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Insight version failed";
      return reply.code(message.includes("not found") ? 404 : 500).send({ message });
    }
  });

  app.get("/:artifactId/diff", async (request, reply) => {
    const params = artifactParamsSchema.safeParse(request.params);
    const query = diffQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ message: "Invalid Insight diff" });
    try { return options.insightService.diffVersions(params.data.artifactId, query.data.from, query.data.to); }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Insight diff failed";
      return reply.code(message.includes("not found") ? 404 : 500).send({ message });
    }
  });

  app.post("/from-message", async (request, reply) => {
    const parsed = createInsightFromMessageRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid Insight request", issues: parsed.error.issues });
    }
    try {
      return reply.code(201).send(options.insightService.createFromMessage(parsed.data));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Insight creation failed";
      const status = message.includes("not found") ? 404 : message.startsWith("Only") || message.startsWith("Empty") ? 409 : 500;
      return reply.code(status).send({ message });
    }
  });
};
