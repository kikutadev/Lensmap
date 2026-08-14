import type { FastifyPluginAsync } from "fastify";
import multipart from "@fastify/multipart";
import { bookSchema } from "@lensmap/shared";
import type { BookService } from "../books/book-service.js";

interface BookRouteOptions {
  bookService: BookService;
}

export const bookRoutes: FastifyPluginAsync<BookRouteOptions> = async (app, options) => {
  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 512 * 1024 * 1024,
    },
  });

  app.get("/", async () => options.bookService.list().map((book) => bookSchema.parse(book)));

  app.post("/import", async (request, reply) => {
    const part = await request.file();
    if (!part) {
      return reply.code(400).send({ message: "PDF file is required" });
    }

    try {
      const book = await options.bookService.importPdf(part);
      return reply.code(201).send(bookSchema.parse(book));
    } catch (error: unknown) {
      request.log.warn({ err: error }, "PDF import failed");
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "PDF import failed",
      });
    }
  });

};
