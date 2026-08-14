import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { installLocalCapabilityAuth } from "./local-capability-auth.js";

const TOKEN = "test-capability-token-that-is-long-enough-1234567890";
const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("local capability auth", () => {
  it("leaves health public but protects all other routes", async () => {
    const app = Fastify();
    apps.push(app);
    installLocalCapabilityAuth(app, TOKEN);
    app.get("/api/health", async () => ({ ok: true }));
    app.get("/api/private", async () => ({ ok: true }));

    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/private" })).statusCode).toBe(401);
    expect((await app.inject({
      method: "GET",
      url: "/api/private",
      headers: { authorization: `Bearer ${TOKEN}` },
    })).statusCode).toBe(200);
  });

  it("rejects malformed or incorrect bearer tokens", async () => {
    const app = Fastify();
    apps.push(app);
    installLocalCapabilityAuth(app, TOKEN);
    app.post("/api/write", async () => ({ ok: true }));

    for (const authorization of ["Basic abc", "Bearer wrong", "Bearer token with spaces"]) {
      const response = await app.inject({ method: "POST", url: "/api/write", headers: { authorization } });
      expect(response.statusCode).toBe(401);
    }
  });

  it("can be disabled for direct development and isolated tests", async () => {
    const app = Fastify();
    apps.push(app);
    installLocalCapabilityAuth(app, null);
    app.get("/api/private", async () => ({ ok: true }));

    expect((await app.inject({ method: "GET", url: "/api/private" })).statusCode).toBe(200);
  });
});
