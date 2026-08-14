import { createReadStream, existsSync } from "node:fs";
import type { FastifyPluginAsync } from "fastify";
import multipart from "@fastify/multipart";
import {
  createSourceAnchorRequestSchema,
  createVisualSourceRequestSchema,
  resolveSelectionRequestSchema,
  resolveSelectionResponseSchema,
} from "@lensmap/shared";
import type { SourceAnchorService } from "../sources/source-anchor-service.js";
import type { DocumentIndexService } from "../documents/document-index-service.js";
import type { VisualOcrService } from "../sources/visual-ocr-service.js";
import { enrichVisualSourceMetadata } from "../sources/visual-source-enrichment.js";

interface SourceRouteOptions {
  sourceAnchorService: SourceAnchorService;
  documentIndexService: DocumentIndexService;
  visualOcrService?: VisualOcrService;
}

export const sourceRoutes: FastifyPluginAsync<SourceRouteOptions> = async (app, options) => {
  await app.register(multipart, {
    limits: { files: 1, fields: 2, fileSize: 32 * 1024 * 1024 },
  });

  app.get<{ Params: { bookId: string } }>("/", async (request) =>
    options.sourceAnchorService.listByBook(request.params.bookId),
  );

  app.get<{ Params: { bookId: string; assetId: string } }>("/assets/:assetId", async (request, reply) => {
    try {
      const path = options.sourceAnchorService.resolveVisualAsset(request.params.bookId, request.params.assetId);
      if (!existsSync(path)) return reply.code(404).send({ message: "Visual source asset not found" });
      return reply
        .type("image/png")
        .header("cache-control", "private, max-age=300")
        .send(createReadStream(path));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Visual source asset not found";
      return reply.code(404).send({ message });
    }
  });

  app.post<{ Params: { bookId: string } }>("/resolve", async (request, reply) => {
    const parsed = resolveSelectionRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid selection resolution request", issues: parsed.error.issues });
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
    if (!parsed.success) return reply.code(400).send({ message: "Invalid SourceAnchor request", issues: parsed.error.issues });
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
          documentNodeIds = [];
        }
      }
      const source = options.sourceAnchorService.createUserSelection(request.params.bookId, { ...parsed.data, documentNodeIds });
      return reply.code(201).send(source);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "SourceAnchor creation failed";
      return reply.code(message === "Book not found" ? 404 : 400).send({ message });
    }
  });

  /** Store a user-cropped PNG as primary evidence. Derived OCR/location metadata are intentionally optional. */
  app.post<{ Params: { bookId: string } }>("/visual", async (request, reply) => {
    let metadataRaw: string | null = null;
    let png: Buffer | null = null;
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (part.mimetype !== "image/png") throw new Error("Visual Source must be uploaded as image/png");
          png = await part.toBuffer();
        } else if (part.fieldname === "metadata") {
          metadataRaw = String(part.value);
        }
      }
      if (!png) return reply.code(400).send({ message: "Visual Source PNG is required" });
      if (!metadataRaw) return reply.code(400).send({ message: "Visual Source metadata is required" });
      const metadata = createVisualSourceRequestSchema.parse(JSON.parse(metadataRaw));
      const enriched = await enrichVisualSourceMetadata(
        request.params.bookId,
        metadata,
        png,
        options.visualOcrService,
        options.documentIndexService,
        (error) => request.log.warn({ err: error, bookId: request.params.bookId }, "visual enrichment failed; preserving image source"),
      );
      const source = options.sourceAnchorService.createVisualSelection(request.params.bookId, enriched, png);
      return reply.code(201).send(source);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Visual Source creation failed";
      return reply.code(message === "Book not found" ? 404 : 400).send({ message });
    }
  });
};
