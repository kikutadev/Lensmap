import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import type { AppConfig } from "./config.js";

let app: FastifyInstance | undefined;
let tempDir: string | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function createTestConfig(): AppConfig {
  tempDir = mkdtempSync(join(tmpdir(), "deep-reader-test-"));
  return {
    host: "127.0.0.1",
    port: 4317,
    dataDir: tempDir,
    migrationsDir: join(process.cwd(), "drizzle"),
    codexBin: null,
  };
}

function createPdfMultipart() {
  const boundary = "----deep-reader-test-boundary";
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "utf8");
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    pdf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    pdf,
    payload,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

async function importTestBook(server: FastifyInstance): Promise<string> {
  const multipart = createPdfMultipart();
  const response = await server.inject({
    method: "POST",
    url: "/api/books/import",
    headers: multipart.headers,
    payload: multipart.payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>().id;
}

describe("server", () => {
  it("responds to health checks", async () => {
    app = await buildApp({ config: createTestConfig() });
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "deep-reader-server",
      version: "0.1.0",
    });
  });

  it("starts with an empty book library", async () => {
    app = await buildApp({ config: createTestConfig() });
    const response = await app.inject({ method: "GET", url: "/api/books" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("imports a PDF into managed storage and deduplicates by fingerprint", async () => {
    app = await buildApp({ config: createTestConfig() });
    const multipart = createPdfMultipart();

    const first = await app.inject({ method: "POST", url: "/api/books/import", headers: multipart.headers, payload: multipart.payload });
    const second = await app.inject({ method: "POST", url: "/api/books/import", headers: multipart.headers, payload: multipart.payload });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstBook = first.json<{ id: string }>();
    const secondBook = second.json<{ id: string }>();
    expect(secondBook.id).toBe(firstBook.id);

    const library = await app.inject({ method: "GET", url: "/api/books" });
    expect(library.json<unknown[]>()).toHaveLength(1);

    const pdfResponse = await app.inject({ method: "GET", url: `/api/books/${firstBook.id}/pdf` });
    expect(pdfResponse.statusCode).toBe(200);
    expect(pdfResponse.headers["content-type"]).toContain("application/pdf");
    expect(pdfResponse.rawPayload.equals(multipart.pdf)).toBe(true);
  });

  it("persists multiple immutable source anchors for one book", async () => {
    app = await buildApp({ config: createTestConfig() });
    const bookId = await importTestBook(app);
    const sourceBody = {
      pageStart: 79,
      pageEnd: 79,
      quoteRaw: "CDN とエッジの違い",
      quoteNormalized: "CDN とエッジの違い",
      rects: [{ pageIndex: 79, x: 10, y: 20, width: 120, height: 16 }],
      origin: "user-selection",
      documentNodeIds: [],
    };

    const first = await app.inject({
      method: "POST",
      url: `/api/books/${bookId}/sources`,
      payload: sourceBody,
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/books/${bookId}/sources`,
      payload: { ...sourceBody, quoteRaw: "Workers はエッジで動く", quoteNormalized: "Workers はエッジで動く" },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json<{ textHash: string }>().textHash).toHaveLength(64);
    expect(second.json<{ id: string }>().id).not.toBe(first.json<{ id: string }>().id);

    const sources = await app.inject({ method: "GET", url: `/api/books/${bookId}/sources` });
    expect(sources.statusCode).toBe(200);
    expect(sources.json<unknown[]>()).toHaveLength(2);
  });
});
