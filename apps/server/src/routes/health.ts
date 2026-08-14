import type { FastifyPluginAsync } from "fastify";
import { healthResponseSchema } from "@deep-reader/shared";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => healthResponseSchema.parse({
    status: "ok",
    service: "deep-reader-server",
    version: "0.1.0",
  }));
};
