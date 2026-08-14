import type { FastifyPluginAsync } from "fastify";
import {
  createSourceAnchorRequestSchema,
  resolveSelectionRequestSchema,
  resolveSelectionResponseSchema,
} from "@deep-reader/shared";
import type { SourceAnchorService } from "../sources/source-anchor-service.js";
import type { DocumentIndexService } from "../documents/document-index-service.js";

interface SourceRouteOptions {
  sourceAnchorService: SourceAnchorService;
  documentIndexService: DocumentIndexService;
}

export const sourceRoutes: FastifyPluginAsync<SourceRouteOptions> = async (app, options) => {
  app.get<{ Params: { bookId: string } }>("/", async (request) =>
    options.sourceAnchorService.listByBook(request.params.bookId),
  );

  app.post<{ Params: { bookId: string } }>("/resolve", async (request, reply) => {
    const parsed = resolveSelectionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid selection resolution request", issues: parsed.error.issues });
    }
    try {
      const resolution = resolveSelectionResponseSchema.parse(
        await options.documentIndexService.resolveSelectionText(request.params.bookId, parsed.data.quoteRaw),
      );
      const indexStatus = options.documentIndexService.getStatus(request.params.bookId);
      const details = {
        bookId: request.params.bookId,
        selectionLength: parsed.data.quoteRaw.length,
        selectionPreview: parsed.data.quoteRaw.slice(0, 80),
        candidateCount: resolution.candidates.length,
        candidatePages: resolution.candidates.map((candidate) => candidate.pageStart + 1),
        indexStatus: indexStatus.status,
        blockCount: indexStatus.blockCount,
      };
      if (resolution.candidates.length === 0) request.log.warn(details, "selection resolution returned no candidates");
      else request.log.info(details, "selection resolution completed");
      return resolution;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Selection resolution failed";
      return reply.code(message === "Book not found" ? 404 : 400).send({ message });
    }
  });

  app.post<{ Params: { bookId: string } }>("/", async (request, reply) => {
    const parsed = createSourceAnchorRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid SourceAnchor request",
        issues: parsed.error.issues,
      });
    }

    try {
      let documentNodeIds = parsed.data.documentNodeIds;
      if (documentNodeIds.length === 0) {
        try {
          documentNodeIds = await options.documentIndexService.matchSelectionBlocks(
            request.params.bookId,
            parsed.data.rects,
            parsed.data.quoteNormalized,
          );
        } catch {
          // Physical SourceAnchors remain valid even when semantic indexing is unavailable or failed.
          documentNodeIds = [];
        }
      }
      const source = options.sourceAnchorService.createUserSelection(
        request.params.bookId,
        { ...parsed.data, documentNodeIds },
      );
      return reply.code(201).send(source);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "SourceAnchor creation failed";
      return reply.code(message === "Book not found" ? 404 : 400).send({ message });
    }
  });
};
