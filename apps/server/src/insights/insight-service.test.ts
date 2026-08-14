import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BookRepository } from "../books/book-repository.js";
import { ChatRepository } from "../chat/chat-repository.js";
import type { AppConfig } from "../config.js";
import { createDatabase, type DatabaseBundle } from "../persistence/database.js";
import { SourceAnchorRepository } from "../sources/source-anchor-repository.js";
import { SourceAnchorService } from "../sources/source-anchor-service.js";
import { InsightRepository } from "./insight-repository.js";
import { InsightService } from "./insight-service.js";

let tempDir: string | undefined;
let database: DatabaseBundle | undefined;

afterEach(() => {
  database?.sqlite.close();
  database = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

function createTestConfig(): AppConfig {
  tempDir = mkdtempSync(join(tmpdir(), "deep-reader-insight-test-"));
  return {
    host: "127.0.0.1",
    port: 4317,
    dataDir: tempDir,
    migrationsDir: join(process.cwd(), "drizzle"),
    codexBin: null,
  };
}

describe("InsightService", () => {
  it("saves a completed assistant answer independently with block-level source provenance", () => {
    const config = createTestConfig();
    database = createDatabase(config);
    const bookRepository = new BookRepository(database.db);
    const chatRepository = new ChatRepository(database.db);
    const sourceService = new SourceAnchorService(new SourceAnchorRepository(database.db), bookRepository);
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

    const thread = chatRepository.createThread({
      id: "thread-1",
      bookId: "book-1",
      codexThreadId: "codex-thread-1",
      model: "gpt-5.6-sol",
      createdAt: now,
      updatedAt: now,
    });
    const message = chatRepository.createMessage({
      id: "message-1",
      threadId: thread.id,
      role: "assistant",
      content: "説明 [S1]\n\n| A | B |\n| --- | --- |\n| 1 | 2 | [S1][S2]",
      status: "completed",
      codexTurnId: "codex-turn-1",
      createdAt: now,
      updatedAt: now,
    });
    chatRepository.attachSources(message.id, [
      { sourceAnchorId: first.id, sourceLabel: "S1", sourceOrder: 0, includedText: "alpha", truncated: false },
      { sourceAnchorId: second.id, sourceLabel: "S2", sourceOrder: 1, includedText: "beta", truncated: false },
    ]);

    const service = new InsightService(new InsightRepository(database.db), chatRepository, bookRepository);
    const created = service.createFromMessage({ messageId: message.id, title: "比較レポート" });

    expect(created.artifact.title).toBe("比較レポート");
    expect(created.artifact.primaryBookId).toBe("book-1");
    expect(created.artifact.originTurnIds).toEqual(["codex-turn-1"]);
    expect(created.artifact.sourceAnchorIds).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(created.artifact.blocks.map((block) => block.kind)).toEqual(["markdown", "table"]);
    expect(created.artifact.blocks[0]?.sourceAnchorIds).toEqual([first.id]);
    expect(created.artifact.blocks[0]?.sourceRefs).toEqual([{ label: "S1", sourceAnchorId: first.id }]);
    expect(created.artifact.blocks[1]?.sourceAnchorIds).toEqual([first.id, second.id]);
    expect(created.sources).toHaveLength(2);

    const listed = service.listByBook("book-1");
    expect(listed.artifacts).toHaveLength(1);
    expect(listed.artifacts[0]?.sourceCount).toBe(2);

    const firstBlock = created.artifact.blocks[0]!;
    const updated = service.update(created.artifact.id, {
      title: "比較レポート 改訂",
      tags: ["architecture", "cache"],
      blocks: [{ id: firstBlock.id, content: { markdown: "編集した説明 [S1]" } }],
    });
    expect(updated.artifact.version).toBe(2);
    expect(updated.artifact.title).toBe("比較レポート 改訂");
    expect(updated.artifact.tags).toEqual(["architecture", "cache"]);
    expect(updated.artifact.blocks[0]?.groundingStatus).toBe("modified");

    const history = service.listVersions(created.artifact.id);
    expect(history.versions.map((version) => version.version)).toEqual([2, 1]);
    const original = service.getVersionDetail(created.artifact.id, 1);
    expect(original.artifact.blocks[0]?.groundingStatus).toBe("references-checked");
    expect(original.artifact.blocks[0]?.content).toEqual({ markdown: "説明 [S1]" });
    const diff = service.diffVersions(created.artifact.id, 1, 2);
    expect(diff.changes[0]?.change).toBe("modified");
  });
});
