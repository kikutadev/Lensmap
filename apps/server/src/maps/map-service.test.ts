import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MapDraft } from "@lensmap/shared";
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

  it("materializes semantic Map Draft fixtures with the requested primary structured block", () => {
    database = createDatabase(createTestConfig());
    const bookRepository = new BookRepository(database.db);
    const exploreRepository = new ExploreRepository(database.db);
    const sourceService = new SourceAnchorService(new SourceAnchorRepository(database.db), bookRepository);
    const now = new Date().toISOString();
    bookRepository.create({ id: "book-1", title: "Book A", fingerprint: "fixture-book", fileName: "book.pdf", managedPath: "/tmp/book.pdf", pageCount: 10, createdAt: now, updatedAt: now });
    const sourceAnchor = sourceService.createUserSelection("book-1", { pageStart: 1, pageEnd: 1, quoteRaw: "evidence", quoteNormalized: "evidence", rects: [{ pageIndex: 1, x: 0, y: 0, width: 10, height: 10 }], origin: "user-selection", documentNodeIds: [] });
    const workspaceService = new WorkspaceService(new WorkspaceRepository(database.db), bookRepository, sourceService);
    const workspace = workspaceService.create({ name: "Fixtures", bookId: "book-1" });
    const service = new MapService(new MapRepository(database.db), exploreRepository, workspaceService);

    const fixtures: Array<{ semanticKind: MapDraft["semanticKind"]; expectedKind: string; primary: MapDraft["primary"] }> = [
      { semanticKind: "definition", expectedKind: "definition", primary: { type: "definition", term: "Cache", definition: "Stored reusable data", keyPoints: ["Fast reuse"], sourceRefs: ["S1"] } },
      { semanticKind: "comparison", expectedKind: "table", primary: { type: "table", title: "A vs B", columns: ["Aspect", "A", "B"], rows: [["Mode", "x", "y"]], sourceRefs: ["S1"] } },
      { semanticKind: "causal", expectedKind: "diagram", primary: { type: "flow", title: "Cause", direction: "LR", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ source: "a", target: "b" }], sourceRefs: ["S1"] } },
      { semanticKind: "process", expectedKind: "diagram", primary: { type: "flow", title: "Process", direction: "LR", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ source: "a", target: "b" }], sourceRefs: ["S1"] } },
      { semanticKind: "hierarchy", expectedKind: "diagram", primary: { type: "hierarchy", title: "Tree", nodes: [{ id: "root", label: "Root", parentId: null }, { id: "child", label: "Child", parentId: "root" }], sourceRefs: ["S1"] } },
      { semanticKind: "timeline", expectedKind: "diagram", primary: { type: "timeline", title: "History", items: [{ label: "Start", time: "2024" }, { label: "Now", time: "2026" }], sourceRefs: ["S1"] } },
      { semanticKind: "quantitative", expectedKind: "table", primary: { type: "table", title: "Few values", columns: ["Item", "Value"], rows: [["A", "1"], ["B", "2"]], sourceRefs: ["S1"] } },
      { semanticKind: "quantitative", expectedKind: "chart", primary: { type: "chart", chartType: "line", title: "Trend", dataNature: "source", xKey: "t", series: [{ dataKey: "v", label: "Value" }], data: [{ t: "1", v: 1 }, { t: "2", v: 2 }], sourceRefs: ["S1"] } },
    ];

    fixtures.forEach((fixture, index) => {
      const thread = exploreRepository.createThread({
        id: `fixture-thread-${index}`, workspaceId: workspace.id, originBookId: "book-1", codexThreadId: `codex-thread-${index}`,
        model: "gpt-5.6-sol", contextToolsVersion: 5, title: "Fixture", conversationSummary: "", createdAt: now, updatedAt: now,
      });
      const message = exploreRepository.createMessage({
        id: `fixture-message-${index}`, threadId: thread.id, role: "assistant", content: `Answer [S1] ${index}`,
        status: "completed", codexTurnId: `fixture-turn-${index}`, createdAt: now, updatedAt: now,
      });
      exploreRepository.attachSources(message.id, [{ sourceAnchorId: sourceAnchor.id, sourceLabel: "S1", sourceOrder: 0, includedText: "evidence", truncated: false }]);
      const created = service.createFromMessage({ messageId: message.id }, {
        semanticKind: fixture.semanticKind,
        title: `Fixture ${index}`,
        conciseExplanation: "Structured",
        primary: fixture.primary,
        supportingBlocks: [],
        sourceRefs: ["S1"],
      });
      expect(created.artifact.semanticKind).toBe(fixture.semanticKind);
      expect(created.artifact.primaryBlockId).toBe(created.artifact.blocks[0]?.id);
      expect(created.artifact.blocks[0]?.kind).toBe(fixture.expectedKind);
      expect(created.artifact.blocks[0]?.sourceRefs).toEqual([{ label: "S1", sourceAnchorId: sourceAnchor.id }]);
    });
  });

});
