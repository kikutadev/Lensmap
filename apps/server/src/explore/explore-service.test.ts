import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExploreTurnStreamEvent } from "@lensmap/shared";
import { BookRepository } from "../books/book-repository.js";
import type { ServerNotificationEnvelope } from "../codex/protocol.js";
import type { AppConfig } from "../config.js";
import { createDatabase, type DatabaseBundle } from "../persistence/database.js";
import { SourceAnchorRepository } from "../sources/source-anchor-repository.js";
import { SourceAnchorService } from "../sources/source-anchor-service.js";
import { WorkspaceRepository } from "../workspaces/workspace-repository.js";
import { WorkspaceService } from "../workspaces/workspace-service.js";
import { ExploreRepository } from "./explore-repository.js";
import { ExploreService, type ReaderCodexClient } from "./explore-service.js";

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
  public readonly startedTurns: Array<{ model?: string; localImages?: Array<{ label: string; path: string }> }> = [];
  public constructor(private readonly capacityOnFirstTurn = false, private readonly imageCapable = true) {}

  public async listModels() {
    return { data: [
      { id: "gpt-5.6-sol", hidden: false, isDefault: true, inputModalities: this.imageCapable ? ["text" as const, "image" as const] : ["text" as const] },
      { id: "gpt-5.6-terra", hidden: false, isDefault: false, inputModalities: this.imageCapable ? ["text" as const, "image" as const] : ["text" as const] },
    ] };
  }
  public async startReaderThread(model: string) { return { thread: { id: "codex-thread-1" }, model }; }
  public async ensureReaderThreadLoaded() {}
  public async startReaderTurn(options: { model?: string; localImages?: Array<{ label: string; path: string }> }) {
    this.startedTurns.push(options);
    this.turnCount += 1;
    const attempt = this.turnCount;
    const turnId = `codex-turn-${attempt}`;
    this.startedModels.push(options.model ?? "");
    setTimeout(() => {
      if (this.capacityOnFirstTurn && attempt === 1) {
        this.emit({ method: "turn/completed", params: { threadId: "codex-thread-1", turn: { id: turnId, status: "failed", error: { message: "Selected model is at capacity. Please try a different model." } } } });
        return;
      }
      this.emit({ method: "item/agentMessage/delta", params: { threadId: "codex-thread-1", turnId, itemId: "item-1", delta: "説明 [S1][S2]" } });
      this.emit({ method: "turn/completed", params: { threadId: "codex-thread-1", turn: { id: turnId, status: "completed", error: null } } });
    }, 0);
    return { turn: { id: turnId, status: "inProgress" } };
  }
  public async interruptReaderTurn() {}
  public onNotification(listener: (notification: ServerNotificationEnvelope) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(notification: ServerNotificationEnvelope) { for (const listener of this.listeners) listener(notification); }
}

function createTestConfig(): AppConfig {
  tempDir = mkdtempSync(join(tmpdir(), "lensmap-explore-test-"));
  return { host: "127.0.0.1", port: 4317, dataDir: tempDir, migrationsDir: join(process.cwd(), "drizzle"), codexBin: null, capabilityToken: null };
}

function createWorkspaceFixture() {
  const config = createTestConfig();
  database = createDatabase(config);
  const bookRepository = new BookRepository(database.db);
  const now = new Date().toISOString();
  for (const [id, title] of [["book-1", "Book A"], ["book-2", "Book B"]] as const) {
    bookRepository.create({ id, title, fingerprint: `fingerprint-${id}`, fileName: `${id}.pdf`, managedPath: `/tmp/${id}.pdf`, pageCount: 10, createdAt: now, updatedAt: now });
  }
  const sourceService = new SourceAnchorService(new SourceAnchorRepository(database.db), bookRepository, tempDir!);
  const first = sourceService.createUserSelection("book-1", { pageStart: 1, pageEnd: 1, quoteRaw: "alpha", quoteNormalized: "alpha", rects: [{ pageIndex: 1, x: 0, y: 0, width: 10, height: 10 }], origin: "user-selection", documentNodeIds: [] });
  const second = sourceService.createUserSelection("book-2", { pageStart: 4, pageEnd: 4, quoteRaw: "beta", quoteNormalized: "beta", rects: [{ pageIndex: 4, x: 0, y: 0, width: 10, height: 10 }], origin: "user-selection", documentNodeIds: [] });
  const workspaceService = new WorkspaceService(new WorkspaceRepository(database.db), bookRepository, sourceService);
  const workspace = workspaceService.create({ name: "Compare", bookId: "book-1" });
  workspaceService.addBook(workspace.id, "book-2");
  workspaceService.addSource(workspace.id, first.id);
  workspaceService.addSource(workspace.id, second.id);
  return { workspaceService, workspaceId: workspace.id, first, second };
}

describe("ExploreService", () => {
  it("streams one turn from sources in multiple PDFs and keeps the thread owned by the Workspace", async () => {
    const fixture = createWorkspaceFixture();
    const service = new ExploreService(new ExploreRepository(database!.db), fixture.workspaceService, new FakeCodex());
    const events: ExploreTurnStreamEvent[] = [];

    await service.streamTurn({ workspaceId: fixture.workspaceId, input: { question: "比較して", sourceIds: [fixture.first.id, fixture.second.id] }, onEvent: (event) => events.push(event) });

    expect(events.some((event) => event.type === "delta")).toBe(true);
    const completed = events.find((event) => event.type === "completed");
    expect(completed?.type === "completed" ? completed.message.content : "").toBe("説明 [S1][S2]");
    const persisted = service.getWorkspaceExplore(fixture.workspaceId);
    expect(persisted.thread?.workspaceId).toBe(fixture.workspaceId);
    expect(persisted.thread?.messages).toHaveLength(2);
    expect(persisted.thread?.messages[1]?.sources.map((source) => [source.label, source.bookTitle])).toEqual([["S1", "Book A"], ["S2", "Book B"]]);

    const secondExplore = await service.createWorkspaceThread(fixture.workspaceId, { title: "別の論点" });
    expect(secondExplore.thread?.messages).toEqual([]);
    expect(service.listWorkspaceThreads(fixture.workspaceId).threads).toHaveLength(2);
    expect(service.getWorkspaceExplore(fixture.workspaceId, secondExplore.thread!.id).thread?.id).toBe(secondExplore.thread?.id);
  });

  it("falls back to another visible model when the selected model is at capacity", async () => {
    const fixture = createWorkspaceFixture();
    const codex = new FakeCodex(true);
    const service = new ExploreService(new ExploreRepository(database!.db), fixture.workspaceService, codex);
    const events: ExploreTurnStreamEvent[] = [];

    await service.streamTurn({ workspaceId: fixture.workspaceId, input: { question: "説明して", sourceIds: [fixture.first.id], model: "gpt-5.6-sol" }, onEvent: (event) => events.push(event) });

    expect(codex.startedModels).toEqual(["gpt-5.6-sol", "gpt-5.6-terra"]);
    expect(events.some((event) => event.type === "error")).toBe(false);
    const completed = events.find((event) => event.type === "completed");
    expect(completed?.type === "completed" ? completed.message.status : "").toBe("completed");
  });
  it("passes Visual Source PNGs to Codex as labeled localImage inputs", async () => {
    const fixture = createWorkspaceFixture();
    const workspace = fixture.workspaceService.get(fixture.workspaceId);
    const sourceService = new SourceAnchorService(
      new SourceAnchorRepository(database!.db),
      new BookRepository(database!.db),
      tempDir!,
    );
    const visual = sourceService.createVisualSelection("book-1", {
      captureImageWidthPx: 1000,
      captureImageHeightPx: 800,
      captureRectNormalized: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      locationStatus: "unresolved",
      recognizedText: "diagram text",
      documentNodeIds: [],
    }, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    fixture.workspaceService.addSource(workspace.id, visual.id);
    const codex = new FakeCodex(false, true);
    const service = new ExploreService(new ExploreRepository(database!.db), fixture.workspaceService, codex);
    const events: ExploreTurnStreamEvent[] = [];

    await service.streamTurn({
      workspaceId: workspace.id,
      input: { question: "この図を説明して", sourceIds: [visual.id] },
      onEvent: (event) => events.push(event),
    });

    expect(events.some((event) => event.type === "completed")).toBe(true);
    expect(codex.startedTurns[0]?.localImages).toHaveLength(1);
    expect(codex.startedTurns[0]?.localImages?.[0]?.label).toBe("S1");
    expect(codex.startedTurns[0]?.localImages?.[0]?.path.endsWith(`${visual.imageAssetId}.png`)).toBe(true);
  });

  it("refuses a Visual Source turn when the explicitly selected model cannot accept images", async () => {
    const fixture = createWorkspaceFixture();
    const sourceService = new SourceAnchorService(
      new SourceAnchorRepository(database!.db),
      new BookRepository(database!.db),
      tempDir!,
    );
    const visual = sourceService.createVisualSelection("book-1", {
      captureImageWidthPx: 1000,
      captureImageHeightPx: 800,
      captureRectNormalized: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      locationStatus: "unresolved",
      documentNodeIds: [],
    }, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    fixture.workspaceService.addSource(fixture.workspaceId, visual.id);
    const service = new ExploreService(new ExploreRepository(database!.db), fixture.workspaceService, new FakeCodex(false, false));

    await expect(service.streamTurn({
      workspaceId: fixture.workspaceId,
      input: { question: "この図を説明して", sourceIds: [visual.id], model: "gpt-5.6-sol" },
      onEvent: () => undefined,
    })).rejects.toThrow(/画像入力対応モデル/u);
  });

});
