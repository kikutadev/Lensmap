import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { BookRepository } from "./books/book-repository.js";
import { BookService } from "./books/book-service.js";
import { ChatRepository } from "./chat/chat-repository.js";
import { ChatService } from "./chat/chat-service.js";
import { BookContextGateway } from "./documents/book-context-gateway.js";
import { DocumentIndexService } from "./documents/document-index-service.js";
import { DocumentRepository } from "./documents/document-repository.js";
import { InsightRepository } from "./insights/insight-repository.js";
import { InsightService } from "./insights/insight-service.js";
import { SourceAnchorRepository } from "./sources/source-anchor-repository.js";
import { SourceAnchorService } from "./sources/source-anchor-service.js";
import { loadConfig, type AppConfig } from "./config.js";
import { CodexAppServerClient } from "./codex/app-server-client.js";
import { createDatabase, type DatabaseBundle } from "./persistence/database.js";
import { bookRoutes } from "./routes/books.js";
import { healthRoutes } from "./routes/health.js";
import { codexRoutes } from "./routes/codex.js";
import { chatRoutes } from "./routes/chat.js";
import { documentRoutes } from "./routes/documents.js";
import { insightRoutes } from "./routes/insights.js";
import { sourceRoutes } from "./routes/sources.js";

export interface BuildAppOptions {
  config?: AppConfig;
  database?: DatabaseBundle;
  codex?: CodexAppServerClient;
}

/** Build the HTTP server without binding a port so tests can inject requests. */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const database = options.database ?? createDatabase(config);
  const app = Fastify({ logger: true });
  const bookRepository = new BookRepository(database.db);
  const bookService = new BookService(bookRepository, config);
  const documentIndexService = new DocumentIndexService(
    new DocumentRepository(database.db, database.sqlite),
    bookRepository,
  );
  const codex = options.codex ?? new CodexAppServerClient({ configuredBinary: config.codexBin });
  const sourceAnchorService = new SourceAnchorService(
    new SourceAnchorRepository(database.db),
    bookRepository,
  );
  const bookContextGateway = new BookContextGateway(documentIndexService, sourceAnchorService);
  const chatRepository = new ChatRepository(database.db);
  const chatService = new ChatService(
    chatRepository,
    bookRepository,
    sourceAnchorService,
    codex,
    bookContextGateway,
  );
  const insightService = new InsightService(
    new InsightRepository(database.db),
    chatRepository,
    bookRepository,
  );

  app.addHook("onClose", async () => {
    await codex.stop();
    database.sqlite.close();
  });

  await app.register(cors, {
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
    methods: ["GET", "HEAD", "POST", "PATCH", "OPTIONS"],
  });
  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(codexRoutes, { prefix: "/api/codex", codex });
  await app.register(bookRoutes, { prefix: "/api/books", bookService });
  await app.register(documentRoutes, {
    prefix: "/api/books/:bookId/document",
    documentIndexService,
  });
  await app.register(sourceRoutes, {
    prefix: "/api/books/:bookId/sources",
    sourceAnchorService,
    documentIndexService,
  });
  await app.register(chatRoutes, {
    prefix: "/api/books/:bookId/chat",
    chatService,
  });
  await app.register(insightRoutes, {
    prefix: "/api/insights",
    insightService,
  });

  return app;
}
