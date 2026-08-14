import { asc, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../persistence/database.js";
import {
  books,
  exploreMessages,
  exploreMessageSources,
  exploreRetrievalEvents,
  exploreThreads,
  sourceAnchors,
} from "../persistence/schema.js";

export type ExploreThreadRecord = typeof exploreThreads.$inferSelect;
export type NewExploreThreadRecord = typeof exploreThreads.$inferInsert;
export type ExploreMessageRecord = typeof exploreMessages.$inferSelect;
export type NewExploreMessageRecord = typeof exploreMessages.$inferInsert;

export interface ExploreMessageSourceRecord {
  sourceAnchorId: string;
  sourceLabel: string;
  sourceOrder: number;
  bookId: string;
  bookTitle: string;
  kind: "text" | "visual";
  imageAssetId: string | null;
  locationStatus: "unresolved" | "page-resolved" | "rect-resolved" | null;
  visualPage: number | null;
  recognizedText: string | null;
  pageStart: number;
  pageEnd: number;
  printedPageLabelStart: string | null;
  printedPageLabelEnd: string | null;
  quoteRaw: string;
  includedText: string | null;
  truncated: boolean;
  origin: "user-selection" | "ai-expansion";
}

/** Persist workspace-owned Explore history and immutable source provenance independently from Codex history. */
export class ExploreRepository {
  public constructor(private readonly db: AppDatabase) {}

  public listThreadsByWorkspace(workspaceId: string): ExploreThreadRecord[] {
    return this.db.select().from(exploreThreads)
      .where(eq(exploreThreads.workspaceId, workspaceId))
      .orderBy(desc(exploreThreads.updatedAt)).all();
  }

  public findLatestThreadByWorkspace(workspaceId: string): ExploreThreadRecord | undefined {
    return this.db.select().from(exploreThreads)
      .where(eq(exploreThreads.workspaceId, workspaceId))
      .orderBy(desc(exploreThreads.updatedAt)).limit(1).get();
  }

  public findThreadById(id: string): ExploreThreadRecord | undefined {
    return this.db.select().from(exploreThreads).where(eq(exploreThreads.id, id)).get();
  }

  public createThread(record: NewExploreThreadRecord): ExploreThreadRecord {
    this.db.insert(exploreThreads).values(record).run();
    const created = this.findThreadById(record.id);
    if (!created) throw new Error("Explore thread could not be persisted");
    return created;
  }

  public updateThreadCodexId(id: string, codexThreadId: string, model: string, contextToolsVersion?: number): ExploreThreadRecord {
    this.db.update(exploreThreads).set({
      codexThreadId,
      model,
      updatedAt: new Date().toISOString(),
      ...(contextToolsVersion === undefined ? {} : { contextToolsVersion }),
    }).where(eq(exploreThreads.id, id)).run();
    const updated = this.findThreadById(id);
    if (!updated) throw new Error("Explore thread disappeared after update");
    return updated;
  }

  public updateThreadMetadata(id: string, patch: { title?: string; conversationSummary?: string; model?: string }): ExploreThreadRecord {
    this.db.update(exploreThreads).set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(exploreThreads.id, id)).run();
    const updated = this.findThreadById(id);
    if (!updated) throw new Error("Explore thread disappeared after metadata update");
    return updated;
  }

  public touchThread(id: string): void {
    this.db.update(exploreThreads).set({ updatedAt: new Date().toISOString() }).where(eq(exploreThreads.id, id)).run();
  }

  public createMessage(record: NewExploreMessageRecord): ExploreMessageRecord {
    this.db.insert(exploreMessages).values(record).run();
    const created = this.findMessageById(record.id);
    if (!created) throw new Error("Explore message could not be persisted");
    return created;
  }

  public findMessageById(id: string): ExploreMessageRecord | undefined {
    return this.db.select().from(exploreMessages).where(eq(exploreMessages.id, id)).get();
  }

  public updateMessage(id: string, patch: Partial<Pick<ExploreMessageRecord, "content" | "status" | "codexTurnId">>): ExploreMessageRecord {
    this.db.update(exploreMessages).set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(exploreMessages.id, id)).run();
    const updated = this.findMessageById(id);
    if (!updated) throw new Error("Explore message disappeared after update");
    return updated;
  }

  public attachSources(messageId: string, sources: Array<{ sourceAnchorId: string; sourceLabel: string; sourceOrder: number; includedText: string; truncated: boolean }>): void {
    if (sources.length === 0) return;
    this.db.insert(exploreMessageSources).values(sources.map((source) => ({
      messageId,
      sourceAnchorId: source.sourceAnchorId,
      sourceLabel: source.sourceLabel,
      sourceOrder: source.sourceOrder,
      includedText: source.includedText,
      wasTruncated: source.truncated,
    }))).onConflictDoNothing().run();
  }

  public createRetrievalEvents(assistantMessageId: string, events: Array<{ id: string; toolName: string; arguments: unknown; resultSummary: unknown; createdAt: string }>): void {
    if (events.length === 0) return;
    this.db.insert(exploreRetrievalEvents).values(events.map((event) => ({
      id: event.id,
      assistantMessageId,
      toolName: event.toolName,
      argumentsJson: JSON.stringify(event.arguments),
      resultSummaryJson: JSON.stringify(event.resultSummary),
      createdAt: event.createdAt,
    }))).onConflictDoNothing().run();
  }

  public listRetrievalEvents(assistantMessageId: string) {
    return this.db.select().from(exploreRetrievalEvents)
      .where(eq(exploreRetrievalEvents.assistantMessageId, assistantMessageId))
      .orderBy(asc(exploreRetrievalEvents.createdAt)).all()
      .map((event) => ({
        id: event.id,
        toolName: event.toolName,
        arguments: parseJson(event.argumentsJson),
        resultSummary: parseJson(event.resultSummaryJson),
        createdAt: event.createdAt,
      }));
  }

  public listMessages(threadId: string): ExploreMessageRecord[] {
    return this.db.select().from(exploreMessages)
      .where(eq(exploreMessages.threadId, threadId))
      .orderBy(asc(exploreMessages.createdAt)).all();
  }

  public listMessageSources(messageId: string): ExploreMessageSourceRecord[] {
    return this.db.select({
      sourceAnchorId: exploreMessageSources.sourceAnchorId,
      sourceLabel: exploreMessageSources.sourceLabel,
      sourceOrder: exploreMessageSources.sourceOrder,
      includedText: exploreMessageSources.includedText,
      truncated: exploreMessageSources.wasTruncated,
      bookId: sourceAnchors.bookId,
      bookTitle: books.title,
      kind: sourceAnchors.kind,
      imageAssetId: sourceAnchors.imageAssetId,
      locationStatus: sourceAnchors.locationStatus,
      visualPage: sourceAnchors.visualPage,
      recognizedText: sourceAnchors.recognizedText,
      pageStart: sourceAnchors.pageStart,
      pageEnd: sourceAnchors.pageEnd,
      printedPageLabelStart: sourceAnchors.printedPageLabelStart,
      printedPageLabelEnd: sourceAnchors.printedPageLabelEnd,
      quoteRaw: sourceAnchors.quoteRaw,
      origin: sourceAnchors.origin,
    }).from(exploreMessageSources)
      .innerJoin(sourceAnchors, eq(exploreMessageSources.sourceAnchorId, sourceAnchors.id))
      .innerJoin(books, eq(sourceAnchors.bookId, books.id))
      .where(eq(exploreMessageSources.messageId, messageId))
      .orderBy(asc(exploreMessageSources.sourceOrder)).all();
  }
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}
