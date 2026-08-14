import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BookRepository } from "../books/book-repository.js";
import { ExploreRepository } from "../explore/explore-repository.js";
import type { AppConfig } from "../config.js";
import { createDatabase, type DatabaseBundle } from "../persistence/database.js";
import { SourceAnchorRepository } from "../sources/source-anchor-repository.js";
import { SourceAnchorService } from "../sources/source-anchor-service.js";
import { WorkspaceRepository } from "../workspaces/workspace-repository.js";
import { WorkspaceService } from "../workspaces/workspace-service.js";
import { MapRepository } from "./map-repository.js";
import { MapService } from "./map-service.js";

let tempDir: string | undefined;
let database: DatabaseBundle | undefined;

afterEach(() => {
  database?.sqlite.close();
  database = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

function createTestConfig(): AppConfig {
  tempDir = mkdtempSync(join(tmpdir(), "lensmap-map-test-"));
  return { host: "127.0.0.1", port: 4317, dataDir: tempDir, migrationsDir: join(process.cwd(), "drizzle"), codexBin: null, capabilityToken: null };
}

describe("MapService Maps", () => {
  it("auto-saves one completed answer as a workspace Map with cross-PDF provenance and immutable versions", () => {
    database = createDatabase(createTestConfig());
    const bookRepository = new BookRepository(database.db);
    const exploreRepository = new ExploreRepository(database.db);
    const sourceService = new SourceAnchorService(new SourceAnchorRepository(database.db), bookRepository);
    const now = new Date().toISOString();

    for (const [id, title] of [["book-1", "Book A"], ["book-2", "Book B"]] as const) {
      bookRepository.create({ id, title, fingerprint: `fingerprint-${id}`, fileName: `${id}.pdf`, managedPath: `/tmp/${id}.pdf`, pageCount: 10, createdAt: now, updatedAt: now });
    }
    const first = sourceService.createUserSelection("book-1", { pageStart: 1, pageEnd: 1, quoteRaw: "alpha", quoteNormalized: "alpha", rects: [{ pageIndex: 1, x: 0, y: 0, width: 10, height: 10 }], origin: "user-selection", documentNodeIds: [] });
    const second = sourceService.createUserSelection("book-2", { pageStart: 4, pageEnd: 4, quoteRaw: "beta", quoteNormalized: "beta", rects: [{ pageIndex: 4, x: 0, y: 0, width: 10, height: 10 }], origin: "user-selection", documentNodeIds: [] });
    const workspaceService = new WorkspaceService(new WorkspaceRepository(database.db), bookRepository, sourceService);
    const workspace = workspaceService.create({ name: "Comparison", bookId: "book-1" });
    workspaceService.addBook(workspace.id, "book-2");

    const thread = exploreRepository.createThread({
      id: "thread-1", workspaceId: workspace.id, originBookId: "book-1", codexThreadId: "codex-thread-1",
      model: "gpt-5.6-sol", contextToolsVersion: 4, title: "Comparison", conversationSummary: "", createdAt: now, updatedAt: now,
    });
    const message = exploreRepository.createMessage({
      id: "message-1", threadId: thread.id, role: "assistant",
      content: "説明 [S1]\n\n| A | B |\n| --- | --- |\n| 1 | 2 | [S1][S2]",
      status: "completed", codexTurnId: "codex-turn-1", createdAt: now, updatedAt: now,
    });
    exploreRepository.attachSources(message.id, [
      { sourceAnchorId: first.id, sourceLabel: "S1", sourceOrder: 0, includedText: "alpha", truncated: false },
      { sourceAnchorId: second.id, sourceLabel: "S2", sourceOrder: 1, includedText: "beta", truncated: false },
    ]);

    const service = new MapService(new MapRepository(database.db), exploreRepository, workspaceService);
    const created = service.createFromMessage({ messageId: message.id, title: "比較レポート" });
    const duplicate = service.createFromMessage({ messageId: message.id });

    expect(duplicate.artifact.id).toBe(created.artifact.id);
    expect(created.artifact.workspaceId).toBe(workspace.id);
    expect(created.artifact.originTurnIds).toEqual(["codex-turn-1"]);
    expect(created.artifact.sourceAnchorIds).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(created.artifact.blocks.map((block) => block.kind)).toEqual(["narrative", "table"]);
    expect(created.sources.map((source) => source.bookTitle)).toEqual(["Book A", "Book B"]);

    const listed = service.listByWorkspace(workspace.id);
    expect(listed.artifacts).toHaveLength(1);
    expect(listed.artifacts[0]?.sourceCount).toBe(2);
    expect(listed.artifacts[0]?.sourceBooks).toEqual([
      { bookId: "book-1", title: "Book A", pages: [2] },
      { bookId: "book-2", title: "Book B", pages: [5] },
    ]);

    const firstBlock = created.artifact.blocks[0]!;
    const updated = service.update(created.artifact.id, {
      title: "比較レポート 改訂",
      tags: ["architecture", "cache"],
      blocks: [{ id: firstBlock.id, content: { markdown: "編集した説明 [S1]" } }],
    });
    expect(updated.artifact.version).toBe(2);
    expect(updated.artifact.blocks[0]?.groundingStatus).toBe("modified");
    expect(service.listVersions(created.artifact.id).versions.map((version) => version.version)).toEqual([2, 1]);
    expect(service.diffVersions(created.artifact.id, 1, 2).changes[0]?.change).toBe("modified");
  });
});
