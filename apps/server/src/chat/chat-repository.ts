import { asc, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../persistence/database.js";
import {
  chatMessages,
  chatMessageSources,
  chatRetrievalEvents,
  chatThreads,
  sourceAnchors,
} from "../persistence/schema.js";

export type ChatThreadRecord = typeof chatThreads.$inferSelect;
export type NewChatThreadRecord = typeof chatThreads.$inferInsert;
export type ChatMessageRecord = typeof chatMessages.$inferSelect;
export type NewChatMessageRecord = typeof chatMessages.$inferInsert;

export interface ChatMessageSourceRecord {
  sourceAnchorId: string;
  sourceLabel: string;
  sourceOrder: number;
  bookId: string;
  pageStart: number;
  pageEnd: number;
  printedPageLabelStart: string | null;
  printedPageLabelEnd: string | null;
  quoteRaw: string;
  includedText: string | null;
  truncated: boolean;
  origin: "user-selection" | "ai-expansion";
}

/** Persist local chat provenance independently from Codex's own thread history. */
export class ChatRepository {
  public constructor(private readonly db: AppDatabase) {}

  public listThreadsByBook(bookId: string): ChatThreadRecord[] {
    return this.db.select().from(chatThreads)
      .where(eq(chatThreads.bookId, bookId))
      .orderBy(desc(chatThreads.updatedAt)).all();
  }

  public findLatestThreadByBook(bookId: string): ChatThreadRecord | undefined {
    return this.db
      .select()
      .from(chatThreads)
      .where(eq(chatThreads.bookId, bookId))
      .orderBy(desc(chatThreads.updatedAt))
      .limit(1)
      .get();
  }

  public findThreadById(id: string): ChatThreadRecord | undefined {
    return this.db.select().from(chatThreads).where(eq(chatThreads.id, id)).get();
  }

  public createThread(record: NewChatThreadRecord): ChatThreadRecord {
    this.db.insert(chatThreads).values(record).run();
    const created = this.findThreadById(record.id);
    if (!created) throw new Error("Chat thread could not be persisted");
    return created;
  }

  public updateThreadCodexId(
    id: string,
    codexThreadId: string,
    model: string,
    contextToolsVersion?: number,
  ): ChatThreadRecord {
    const updatedAt = new Date().toISOString();
    this.db.update(chatThreads)
      .set({
        codexThreadId,
        model,
        updatedAt,
        ...(contextToolsVersion === undefined ? {} : { contextToolsVersion }),
      })
      .where(eq(chatThreads.id, id))
      .run();
    const updated = this.findThreadById(id);
    if (!updated) throw new Error("Chat thread disappeared after update");
    return updated;
  }

  public updateThreadMetadata(id: string, patch: { title?: string; conversationSummary?: string }): ChatThreadRecord {
    this.db.update(chatThreads).set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(chatThreads.id, id)).run();
    const updated = this.findThreadById(id);
    if (!updated) throw new Error("Chat thread disappeared after metadata update");
    return updated;
  }

  public touchThread(id: string): void {
    this.db.update(chatThreads)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(chatThreads.id, id))
      .run();
  }

  public createMessage(record: NewChatMessageRecord): ChatMessageRecord {
    this.db.insert(chatMessages).values(record).run();
    const created = this.findMessageById(record.id);
    if (!created) throw new Error("Chat message could not be persisted");
    return created;
  }

  public findMessageById(id: string): ChatMessageRecord | undefined {
    return this.db.select().from(chatMessages).where(eq(chatMessages.id, id)).get();
  }

  public updateMessage(
    id: string,
    patch: Partial<Pick<ChatMessageRecord, "content" | "status" | "codexTurnId">>,
  ): ChatMessageRecord {
    this.db.update(chatMessages)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(chatMessages.id, id))
      .run();
    const updated = this.findMessageById(id);
    if (!updated) throw new Error("Chat message disappeared after update");
    return updated;
  }

  public attachSources(
    messageId: string,
    sources: Array<{ sourceAnchorId: string; sourceLabel: string; sourceOrder: number; includedText: string; truncated: boolean }>,
  ): void {
    if (sources.length === 0) return;
    this.db.insert(chatMessageSources).values(
      sources.map((source) => ({
        messageId,
        sourceAnchorId: source.sourceAnchorId,
        sourceLabel: source.sourceLabel,
        sourceOrder: source.sourceOrder,
        includedText: source.includedText,
        wasTruncated: source.truncated,
      })),
    ).onConflictDoNothing().run();
  }

  public createRetrievalEvents(
    assistantMessageId: string,
    events: Array<{ id: string; toolName: string; arguments: unknown; resultSummary: unknown; createdAt: string }>,
  ): void {
    if (events.length === 0) return;
    this.db.insert(chatRetrievalEvents).values(events.map((event) => ({
      id: event.id,
      assistantMessageId,
      toolName: event.toolName,
      argumentsJson: JSON.stringify(event.arguments),
      resultSummaryJson: JSON.stringify(event.resultSummary),
      createdAt: event.createdAt,
    }))).onConflictDoNothing().run();
  }

  public listRetrievalEvents(assistantMessageId: string) {
    return this.db
      .select()
      .from(chatRetrievalEvents)
      .where(eq(chatRetrievalEvents.assistantMessageId, assistantMessageId))
      .orderBy(asc(chatRetrievalEvents.createdAt))
      .all()
      .map((event) => ({
        id: event.id,
        toolName: event.toolName,
        arguments: parseJson(event.argumentsJson),
        resultSummary: parseJson(event.resultSummaryJson),
        createdAt: event.createdAt,
      }));
  }

  public listMessages(threadId: string): ChatMessageRecord[] {
    return this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(asc(chatMessages.createdAt))
      .all();
  }

  public listMessageSources(messageId: string): ChatMessageSourceRecord[] {
    return this.db
      .select({
        sourceAnchorId: chatMessageSources.sourceAnchorId,
        sourceLabel: chatMessageSources.sourceLabel,
        sourceOrder: chatMessageSources.sourceOrder,
        includedText: chatMessageSources.includedText,
        truncated: chatMessageSources.wasTruncated,
        bookId: sourceAnchors.bookId,
        pageStart: sourceAnchors.pageStart,
        pageEnd: sourceAnchors.pageEnd,
        printedPageLabelStart: sourceAnchors.printedPageLabelStart,
        printedPageLabelEnd: sourceAnchors.printedPageLabelEnd,
        quoteRaw: sourceAnchors.quoteRaw,
        origin: sourceAnchors.origin,
      })
      .from(chatMessageSources)
      .innerJoin(sourceAnchors, eq(chatMessageSources.sourceAnchorId, sourceAnchors.id))
      .where(eq(chatMessageSources.messageId, messageId))
      .orderBy(asc(chatMessageSources.sourceOrder))
      .all();
  }
}


function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
