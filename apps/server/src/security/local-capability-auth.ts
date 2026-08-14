import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

const HEALTH_PATH = "/api/health";

/**
 * Protect the loopback API with a per-server capability token.
 * Health remains unauthenticated so the extension can determine whether a local server exists
 * before asking the Native Messaging host for the current capability.
 */
export function installLocalCapabilityAuth(app: FastifyInstance, expectedToken: string | null | undefined): void {
  if (!expectedToken) return;

  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "OPTIONS" || isHealthRequest(request.url)) return;

    const token = readBearerToken(request.headers.authorization);
    if (token && constantTimeEqual(token, expectedToken)) return;

    return reply
      .code(401)
      .header("www-authenticate", "Bearer realm=\"Lensmap Local API\"")
      .send({ message: "Lensmap local capability token is required" });
  });
}

function isHealthRequest(url: string): boolean {
  return url === HEALTH_PATH || url.startsWith(`${HEALTH_PATH}?`);
}

function readBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/iu.exec(header.trim());
  return match?.[1] ?? null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
