import type { FastifyPluginAsync } from "fastify";
import { healthResponseSchema } from "@lensmap/shared";

interface HealthRouteOptions {
  capabilityRequired: boolean;
}

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (app, options) => {
  app.get("/health", async () => healthResponseSchema.parse({
    status: "ok",
    service: "lensmap-server",
    version: "0.1.0",
    capabilityRequired: options.capabilityRequired,
  }));
};
