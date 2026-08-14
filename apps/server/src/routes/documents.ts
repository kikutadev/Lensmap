import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { DocumentIndexService } from "../documents/document-index-service.js";

interface DocumentRouteOptions {
  documentIndexService: DocumentIndexService;
}

const pageParamsSchema = z.object({
  bookId: z.string().min(1),
  pageIndex: z.coerce.number().int().nonnegative(),
});
const bookParamsSchema = z.object({ bookId: z.string().min(1) });
const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(2_000),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** Local document-structure and FTS5 endpoints used by reader diagnostics and future AI retrieval tools. */
export const documentRoutes: FastifyPluginAsync<DocumentRouteOptions> = async (app, options) => {
  app.get("/index/status", async (request, reply) => {
    const params = bookParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid book id" });
    try {
      return options.documentIndexService.getStatus(params.data.bookId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Index status failed";
      return reply.code(message === "Book not found" ? 404 : 500).send({ message });
    }
  });

  app.post("/index", async (request, reply) => {
    const params = bookParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid book id" });
    const force = z.object({ force: z.boolean().optional() }).safeParse(request.body);
    try {
      await options.documentIndexService.startIndex(params.data.bookId, force.success ? force.data.force ?? false : false);
      return options.documentIndexService.getStatus(params.data.bookId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "PDF indexing failed";
      return reply.code(message === "Book not found" ? 404 : 500).send({ message });
    }
  });

  app.get("/outline", async (request, reply) => {
    const params = bookParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid book id" });
    try {
      return await options.documentIndexService.getOutline(params.data.bookId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Book outline failed";
      return reply.code(message === "Book not found" ? 404 : 500).send({ message });
    }
  });

  app.get("/search", async (request, reply) => {
    const params = bookParamsSchema.safeParse(request.params);
    const query = searchQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.code(400).send({ message: "Invalid search request" });
    }
    try {
      return await options.documentIndexService.searchBook(params.data.bookId, query.data.q, query.data.limit);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Book search failed";
      return reply.code(message === "Book not found" ? 404 : 500).send({ message });
    }
  });

  app.get("/pages/:pageIndex/blocks", async (request, reply) => {
    const params = pageParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid page" });
    try {
      return await options.documentIndexService.getPageBlocks(params.data.bookId, params.data.pageIndex);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Page blocks failed";
      return reply.code(message === "Book not found" ? 404 : 500).send({ message });
    }
  });
};
