import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { BookRepository } from "./books/book-repository.js";
import { BookService } from "./books/book-service.js";
import { ExploreRepository } from "./explore/explore-repository.js";
import { ExploreService } from "./explore/explore-service.js";
import { BookContextGateway } from "./documents/book-context-gateway.js";
import { DocumentIndexService } from "./documents/document-index-service.js";
import { DocumentRepository } from "./documents/document-repository.js";
import { MapRepository } from "./maps/map-repository.js";
import { MapService } from "./maps/map-service.js";
import { WorkspaceRepository } from "./workspaces/workspace-repository.js";
import { WorkspaceService } from "./workspaces/workspace-service.js";
import { SourceAnchorRepository } from "./sources/source-anchor-repository.js";
import { SourceAnchorService } from "./sources/source-anchor-service.js";
import { MacVisionOcrService, type VisualOcrService } from "./sources/visual-ocr-service.js";
import { loadConfig, type AppConfig } from "./config.js";
import { CodexAppServerClient } from "./codex/app-server-client.js";
import { createDatabase, type DatabaseBundle } from "./persistence/database.js";
import { bookRoutes } from "./routes/books.js";
import { healthRoutes } from "./routes/health.js";
import { codexRoutes } from "./routes/codex.js";
import { exploreRoutes } from "./routes/explore.js";
import { documentRoutes } from "./routes/documents.js";
import { mapRoutes } from "./routes/maps.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { sourceRoutes } from "./routes/sources.js";
import { installLocalCapabilityAuth } from "./security/local-capability-auth.js";

export interface BuildAppOptions {
  config?: AppConfig;
  database?: DatabaseBundle;
  codex?: CodexAppServerClient;
  visualOcrService?: VisualOcrService;
}

/** Build the HTTP server without binding a port so tests can inject requests. */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const database = options.database ?? createDatabase(config);
  const app = Fastify({ logger: true });
  installLocalCapabilityAuth(app, config.capabilityToken);
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
    config.dataDir,
  );
  const visualOcrService = options.visualOcrService ?? new MacVisionOcrService(config.visualOcrBin ?? null);
  const bookContextGateway = new BookContextGateway(documentIndexService, sourceAnchorService);
  const workspaceService = new WorkspaceService(new WorkspaceRepository(database.db), bookRepository, sourceAnchorService);
  const exploreRepository = new ExploreRepository(database.db);
  const mapService = new MapService(new MapRepository(database.db), exploreRepository, workspaceService);
  const exploreService = new ExploreService(exploreRepository, workspaceService, codex, bookContextGateway, mapService);

  app.addHook("onClose", async () => {
    await codex.stop();
    database.sqlite.close();
  });

  await app.register(cors, {
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(healthRoutes, { prefix: "/api", capabilityRequired: Boolean(config.capabilityToken) });
  await app.register(codexRoutes, { prefix: "/api/codex", codex });
  await app.register(bookRoutes, { prefix: "/api/books", bookService });
  await app.register(workspaceRoutes, { prefix: "/api/workspaces", workspaceService });
  await app.register(documentRoutes, {
    prefix: "/api/books/:bookId/document",
    documentIndexService,
  });
  await app.register(sourceRoutes, {
    prefix: "/api/books/:bookId/sources",
    sourceAnchorService,
    documentIndexService,
    visualOcrService,
  });
  await app.register(exploreRoutes, { prefix: "/api/workspaces/:workspaceId/explore", exploreService });
  await app.register(mapRoutes, { prefix: "/api/maps", mapService });

  return app;
}
