import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatTurnStreamEvent } from "@deep-reader/shared";
import { BookRepository } from "../books/book-repository.js";
import type { ServerNotificationEnvelope } from "../codex/protocol.js";
import type { AppConfig } from "../config.js";
import { createDatabase, type DatabaseBundle } from "../persistence/database.js";
import { SourceAnchorRepository } from "../sources/source-anchor-repository.js";
import { SourceAnchorService } from "../sources/source-anchor-service.js";
import { ChatRepository } from "./chat-repository.js";
import { ChatService, type ReaderCodexClient } from "./chat-service.js";

let tempDir: string | undefined;
let database: DatabaseBundle | undefined;

afterEach(() => {
  database?.sqlite.close();
  database = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

class FakeCodex implements ReaderCodexClient {
  private listeners = new Set<(notification: ServerNotificationEnvelope) => void>();
  private turnCount = 0;
  public readonly startedModels: string[] = [];

  public constructor(private readonly capacityOnFirstTurn = false) {}

  public async listModels() {
    return {
      data: [
        { id: "gpt-5.6-sol", hidden: false, isDefault: true },
        { id: "gpt-5.6-terra", hidden: false, isDefault: false },
      ],
    };
  }

  public async startReaderThread(model: string) {
    return { thread: { id: "codex-thread-1" }, model };
  }

  public async ensureReaderThreadLoaded() {}

  public async startReaderTurn(options: { model?: string }) {
    this.turnCount += 1;
    const turnId = `codex-turn-${this.turnCount}`;
    this.startedModels.push(options.model ?? "");
    setTimeout(() => {
      if (this.capacityOnFirstTurn && this.turnCount === 1) {
        this.emit({
          method: "turn/completed",
          params: {
            threadId: "codex-thread-1",
            turn: {
              id: turnId,
              status: "failed",
              error: { message: "Selected model is at capacity. Please try a different model." },
            },
          },
        });
        return;
      }
      this.emit({
        method: "item/agentMessage/delta",
        params: { threadId: "codex-thread-1", turnId, itemId: "item-1", delta: "説明 [S1][S2]" },
      });
      this.emit({
        method: "turn/completed",
        params: { threadId: "codex-thread-1", turn: { id: turnId, status: "completed", error: null } },
      });
    }, 0);
    return { turn: { id: turnId, status: "inProgress" } };
  }

  public async interruptReaderTurn() {}

  public onNotification(listener: (notification: ServerNotificationEnvelope) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(notification: ServerNotificationEnvelope) {
    for (const listener of this.listeners) listener(notification);
  }
}

function createTestConfig(): AppConfig {
  tempDir = mkdtempSync(join(tmpdir(), "deep-reader-chat-test-"));
  return {
    host: "127.0.0.1",
    port: 4317,
    dataDir: tempDir,
    migrationsDir: join(process.cwd(), "drizzle"),
    codexBin: null,
  };
}

describe("ChatService", () => {
  it("streams a grounded answer and persists source provenance on both messages", async () => {
    const config = createTestConfig();
    database = createDatabase(config);
    const bookRepository = new BookRepository(database.db);
    const now = new Date().toISOString();
    bookRepository.create({
      id: "book-1",
      title: "Book",
      fingerprint: "fingerprint",
      fileName: "book.pdf",
      managedPath: "/tmp/book.pdf",
      pageCount: 10,
      createdAt: now,
      updatedAt: now,
    });
    const sourceService = new SourceAnchorService(new SourceAnchorRepository(database.db), bookRepository);
    const first = sourceService.createUserSelection("book-1", {
      pageStart: 1,
      pageEnd: 1,
      quoteRaw: "alpha",
      quoteNormalized: "alpha",
      rects: [{ pageIndex: 1, x: 0, y: 0, width: 10, height: 10 }],
      origin: "user-selection",
      documentNodeIds: [],
    });
    const second = sourceService.createUserSelection("book-1", {
      pageStart: 4,
      pageEnd: 4,
      quoteRaw: "beta",
      quoteNormalized: "beta",
      rects: [{ pageIndex: 4, x: 0, y: 0, width: 10, height: 10 }],
      origin: "user-selection",
      documentNodeIds: [],
    });
    const service = new ChatService(
      new ChatRepository(database.db),
      bookRepository,
      sourceService,
      new FakeCodex(),
    );
    const events: ChatTurnStreamEvent[] = [];

    await service.streamTurn({
      bookId: "book-1",
      input: { question: "比較して", sourceIds: [first.id, second.id] },
      onEvent: (event) => events.push(event),
    });

    expect(events.some((event) => event.type === "delta")).toBe(true);
    const completed = events.find((event) => event.type === "completed");
    expect(completed?.type === "completed" ? completed.message.content : "").toBe("説明 [S1][S2]");

    const persisted = service.getBookChat("book-1");
    expect(persisted.thread?.messages).toHaveLength(2);
    expect(persisted.thread?.messages[0]?.sources.map((source) => source.label)).toEqual(["S1", "S2"]);
    expect(persisted.thread?.messages[1]?.sources.map((source) => source.label)).toEqual(["S1", "S2"]);

    const secondChat = await service.createBookThread("book-1", { title: "別の論点" });
    expect(secondChat.thread?.messages).toEqual([]);
    expect(secondChat.thread?.title).toBe("別の論点");
    const threads = service.listBookThreads("book-1");
    expect(threads.threads).toHaveLength(2);
    expect(service.getBookChat("book-1", secondChat.thread!.id).thread?.id).toBe(secondChat.thread?.id);
  });

  it("falls back to another visible model when the selected model is at capacity", async () => {
    const config = createTestConfig();
    database = createDatabase(config);
    const bookRepository = new BookRepository(database.db);
    const now = new Date().toISOString();
    bookRepository.create({
      id: "book-1",
      title: "Book",
      fingerprint: "fingerprint",
      fileName: "book.pdf",
      managedPath: "/tmp/book.pdf",
      pageCount: 10,
      createdAt: now,
      updatedAt: now,
    });
    const sourceService = new SourceAnchorService(new SourceAnchorRepository(database.db), bookRepository);
    const source = sourceService.createUserSelection("book-1", {
      pageStart: 1,
      pageEnd: 1,
      quoteRaw: "alpha",
      quoteNormalized: "alpha",
      rects: [{ pageIndex: 1, x: 0, y: 0, width: 10, height: 10 }],
      origin: "user-selection",
      documentNodeIds: [],
    });
    const codex = new FakeCodex(true);
    const service = new ChatService(
      new ChatRepository(database.db),
      bookRepository,
      sourceService,
      codex,
    );
    const events: ChatTurnStreamEvent[] = [];

    await service.streamTurn({
      bookId: "book-1",
      input: { question: "説明して", sourceIds: [source.id], model: "gpt-5.6-sol" },
      onEvent: (event) => events.push(event),
    });

    expect(codex.startedModels).toEqual(["gpt-5.6-sol", "gpt-5.6-terra"]);
    expect(events.some((event) => event.type === "error")).toBe(false);
    const completed = events.find((event) => event.type === "completed");
    expect(completed?.type === "completed" ? completed.message.status : "").toBe("completed");
  });

});
