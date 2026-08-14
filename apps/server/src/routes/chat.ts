import type { FastifyPluginAsync } from "fastify";
import { chatTurnStreamEventSchema, createChatThreadRequestSchema, startChatTurnRequestSchema } from "@deep-reader/shared";
import { z } from "zod";
import type { ChatService } from "../chat/chat-service.js";

interface ChatRouteOptions {
  chatService: ChatService;
}

interface BookParams {
  bookId: string;
}

/** Expose persisted book chat plus a POST fetch stream for Codex turn deltas. */
export const chatRoutes: FastifyPluginAsync<ChatRouteOptions> = async (app, options) => {
  app.get<{ Params: BookParams }>("/", async (request, reply) => {
    const query = z.object({ threadId: z.string().min(1).optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: "Invalid chat query" });
    try {
      return options.chatService.getBookChat(request.params.bookId, query.data.threadId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Chat could not be loaded";
      return reply.code(message === "Book not found" ? 404 : 500).send({ message });
    }
  });

  app.get<{ Params: BookParams }>("/threads", async (request, reply) => {
    try { return options.chatService.listBookThreads(request.params.bookId); }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Chat threads could not be loaded";
      return reply.code(message === "Book not found" ? 404 : 500).send({ message });
    }
  });

  app.post<{ Params: BookParams }>("/threads", async (request, reply) => {
    const parsed = createChatThreadRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: "Invalid chat thread request", issues: parsed.error.issues });
    try { return reply.code(201).send(await options.chatService.createBookThread(request.params.bookId, parsed.data)); }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Chat thread could not be created";
      return reply.code(message === "Book not found" ? 404 : 500).send({ message });
    }
  });

  app.post<{ Params: BookParams }>("/turns", async (request, reply) => {
    const parsed = startChatTurnRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid Deep Dive request", issues: parsed.error.issues });
    }

    reply.hijack();
    reply.raw.statusCode = 200;
    const origin = request.headers.origin;
    if (origin === "http://127.0.0.1:5173" || origin === "http://localhost:5173") {
      reply.raw.setHeader("access-control-allow-origin", origin);
      reply.raw.setHeader("vary", "Origin");
    }
    reply.raw.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    reply.raw.setHeader("cache-control", "no-cache, no-transform");
    reply.raw.setHeader("x-content-type-options", "nosniff");
    reply.raw.flushHeaders();

    const writeEvent = (event: unknown) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      const validated = chatTurnStreamEventSchema.parse(event);
      reply.raw.write(`${JSON.stringify(validated)}\n`);
    };

    try {
      await options.chatService.streamTurn({
        bookId: request.params.bookId,
        input: parsed.data,
        onEvent: writeEvent,
      });
    } catch (error: unknown) {
      writeEvent({
        type: "error",
        message: error instanceof Error ? error.message : "Deep Dive turn failed",
      });
    } finally {
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });

  app.post<{ Params: BookParams }>("/interrupt", async (request, reply) => {
    try {
      const interrupted = await options.chatService.interruptBookTurn(request.params.bookId);
      return { interrupted };
    } catch (error: unknown) {
      return reply.code(500).send({
        message: error instanceof Error ? error.message : "Deep Dive turn could not be interrupted",
      });
    }
  });
};
