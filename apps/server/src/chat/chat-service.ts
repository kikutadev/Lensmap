import { randomUUID } from "node:crypto";
import {
  bookChatResponseSchema,
  chatMessageSchema,
  type BookChatResponse,
  type BookChatThreadsResponse,
  type CreateChatThreadRequest,
  type ChatMessage,
  type ChatTurnStreamEvent,
  type StartChatTurnRequest,
} from "@deep-reader/shared";
import type { BookRepository } from "../books/book-repository.js";
import type {
  ReaderDynamicToolHandler,
  ReaderDynamicToolSpec,
} from "../codex/app-server-client.js";
import {
  agentMessageDeltaParamsSchema,
  turnCompletedParamsSchema,
  type DynamicToolCallParams,
  type ServerNotificationEnvelope,
} from "../codex/protocol.js";
import type { BookContextGateway } from "../documents/book-context-gateway.js";
import type { SourceAnchorService } from "../sources/source-anchor-service.js";
import { ChatRepository, type ChatMessageRecord, type ChatThreadRecord } from "./chat-repository.js";
import { BookToolSession, BOOK_TOOL_SPECS } from "./book-tool-session.js";
import { findInvalidCitationLabels } from "./citation-validator.js";
import { ContextBuilder } from "./context-builder.js";
import { buildConversationMemory } from "./conversation-memory.js";

export interface StreamChatTurnOptions {
  bookId: string;
  input: StartChatTurnRequest;
  onEvent: (event: ChatTurnStreamEvent) => void;
}

export interface ReaderCodexClient {
  listModels(): Promise<{ data: Array<{ id: string; hidden: boolean; isDefault: boolean }> }>;
  startReaderThread(model: string, dynamicTools?: ReaderDynamicToolSpec[]): Promise<{ thread: { id: string }; model: string }>;
  ensureReaderThreadLoaded(threadId: string): Promise<void>;
  startReaderTurn(options: { threadId: string; text: string; model?: string; effort?: "low" | "medium" | "high" | "xhigh" | "max" | "ultra" }): Promise<{ turn: { id: string; status: string } }>;
  interruptReaderTurn(threadId: string, turnId: string): Promise<void>;
  onNotification(listener: (notification: ServerNotificationEnvelope) => void): () => void;
  setDynamicToolHandler?(handler: ReaderDynamicToolHandler | null): void;
  getModelContextWindowTokens?(): number | null;
}

interface ActiveTurn {
  bookId: string;
  codexThreadId: string;
  codexTurnId: string;
  assistantMessageId: string;
}

const TURN_COMPLETION_TIMEOUT_MS = 10 * 60 * 1000;
const BOOK_CONTEXT_TOOLS_VERSION = 2;

/**
 * Coordinate explicit book sources, local chat persistence, and Codex streaming.
 * Codex thread history is treated as an execution detail; source provenance remains local and auditable.
 */
export class ChatService {
  private readonly activeTurnsByBook = new Map<string, ActiveTurn>();
  private readonly activeBookToolsByCodexThread = new Map<string, BookToolSession>();
  private readonly bookToolsEnabled: boolean;

  public constructor(
    private readonly repository: ChatRepository,
    private readonly bookRepository: BookRepository,
    private readonly sourceAnchorService: SourceAnchorService,
    private readonly codex: ReaderCodexClient,
    private readonly bookContextGateway?: BookContextGateway,
    private readonly contextBuilder = new ContextBuilder(),
  ) {
    this.bookToolsEnabled = Boolean(bookContextGateway && codex.setDynamicToolHandler);
    if (this.bookToolsEnabled) {
      this.codex.setDynamicToolHandler?.((request) => this.handleDynamicBookTool(request));
    }
  }

  public getBookChat(bookId: string, threadId?: string): BookChatResponse {
    if (!this.bookRepository.findById(bookId)) throw new Error("Book not found");
    const thread = threadId
      ? this.repository.findThreadById(threadId)
      : this.repository.findLatestThreadByBook(bookId);
    if (!thread) return bookChatResponseSchema.parse({ thread: null });
    if (thread.bookId !== bookId) throw new Error("Chat thread belongs to a different book");
    return bookChatResponseSchema.parse({
      thread: {
        ...thread,
        messages: this.repository.listMessages(thread.id).map((message) => this.toMessage(message)),
      },
    });
  }

  public listBookThreads(bookId: string): BookChatThreadsResponse {
    if (!this.bookRepository.findById(bookId)) throw new Error("Book not found");
    return {
      threads: this.repository.listThreadsByBook(bookId).map((thread) => ({
        id: thread.id,
        bookId: thread.bookId,
        codexThreadId: thread.codexThreadId,
        model: thread.model,
        title: thread.title,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        messageCount: this.repository.listMessages(thread.id).length,
      })),
    };
  }

  public async createBookThread(bookId: string, input: CreateChatThreadRequest): Promise<BookChatResponse> {
    if (!this.bookRepository.findById(bookId)) throw new Error("Book not found");
    const model = input.model ?? await this.resolveDefaultModel();
    const now = new Date().toISOString();
    const created = this.repository.createThread({
      id: randomUUID(),
      bookId,
      codexThreadId: null,
      model,
      contextToolsVersion: this.bookToolsEnabled ? BOOK_CONTEXT_TOOLS_VERSION : 0,
      title: input.title?.trim() || "新しいDeep Dive",
      conversationSummary: "",
      createdAt: now,
      updatedAt: now,
    });
    return bookChatResponseSchema.parse({ thread: { ...created, messages: [] } });
  }

  public async streamTurn(options: StreamChatTurnOptions): Promise<void> {
    const { bookId, input, onEvent } = options;
    if (!this.bookRepository.findById(bookId)) {
      throw new Error("Book not found");
    }
    if (this.activeTurnsByBook.has(bookId)) {
      throw new Error("A Deep Dive turn is already running for this book");
    }

    const anchors = this.sourceAnchorService.getOrderedForBook(bookId, input.sourceIds);
    const modelCandidates = await this.resolveModelCandidates(input.model);
    const thread = await this.ensureThread(bookId, modelCandidates[0], input.threadId);
    const context = this.contextBuilder.build(input.question, anchors, thread.conversationSummary);
    const toolSession = this.bookToolsEnabled && this.bookContextGateway
      ? new BookToolSession({
        bookId,
        explicitSources: context.sources.map(({ label, source }) => ({ label, source })),
        gateway: this.bookContextGateway,
        limits: { maxRetrievedCharacters: deriveExpansionCharacterBudget(this.codex.getModelContextWindowTokens?.()) },
      })
      : null;
    if (toolSession) {
      this.activeBookToolsByCodexThread.set(thread.codexThreadId, toolSession);
    }
    const sourceLinks = context.sources.map(({ label, source, includedText, truncated }, index) => ({
      sourceAnchorId: source.id,
      sourceLabel: label,
      sourceOrder: index,
      includedText,
      truncated,
    }));

    const timestamp = new Date().toISOString();
    const userRecord = this.repository.createMessage({
      id: randomUUID(),
      threadId: thread.id,
      role: "user",
      content: input.question.trim(),
      status: "completed",
      codexTurnId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const assistantRecord = this.repository.createMessage({
      id: randomUUID(),
      threadId: thread.id,
      role: "assistant",
      content: "",
      status: "streaming",
      codexTurnId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    this.repository.attachSources(userRecord.id, sourceLinks);
    this.repository.attachSources(assistantRecord.id, sourceLinks);
    this.repository.touchThread(thread.id);

    let activeTurnId: string | null = null;
    let accumulated = "";

    const runAttempt = async (model: string): Promise<string> => {
      let attemptTurnId: string | null = null;
      let completionResolve: (() => void) | null = null;
      let completionReject: ((error: Error) => void) | null = null;
      const completion = new Promise<void>((resolve, reject) => {
        completionResolve = resolve;
        completionReject = reject;
      });
      const unsubscribe = this.codex.onNotification((notification) => {
        if (!attemptTurnId) return;
        this.handleNotification(notification, thread.codexThreadId, attemptTurnId, (delta) => {
          accumulated += delta;
          onEvent({ type: "delta", messageId: assistantRecord.id, delta });
        }, (status, errorMessage) => {
          if (status === "completed") {
            completionResolve?.();
          } else {
            completionReject?.(new Error(errorMessage ?? `Codex turn ended with status ${status}`));
          }
        });
      });
      const timeout = setTimeout(() => {
        completionReject?.(new Error("Codex turn timed out"));
      }, TURN_COMPLETION_TIMEOUT_MS);

      try {
        const turnResponse = await this.codex.startReaderTurn({
          threadId: thread.codexThreadId,
          text: context.prompt,
          model,
          effort: "high",
        });
        attemptTurnId = turnResponse.turn.id;
        activeTurnId = attemptTurnId;
        this.activeTurnsByBook.set(bookId, {
          bookId,
          codexThreadId: thread.codexThreadId,
          codexTurnId: attemptTurnId,
          assistantMessageId: assistantRecord.id,
        });

        const updatedUser = this.repository.updateMessage(userRecord.id, { codexTurnId: attemptTurnId });
        const updatedAssistant = this.repository.updateMessage(assistantRecord.id, { codexTurnId: attemptTurnId });
        onEvent({
          type: "turn-started",
          threadId: thread.id,
          codexThreadId: thread.codexThreadId,
          codexTurnId: attemptTurnId,
          userMessage: this.toMessage(updatedUser),
          assistantMessage: this.toMessage(updatedAssistant),
        });

        await completion;
        return attemptTurnId;
      } finally {
        clearTimeout(timeout);
        unsubscribe();
      }
    };

    try {
      let lastError: Error | null = null;
      for (let index = 0; index < modelCandidates.length; index += 1) {
        const model = modelCandidates[index];
        if (!model) continue;
        const contentBeforeAttempt = accumulated.length;
        const retrievalsBeforeAttempt = toolSession?.getAuditEvents().length ?? 0;
        try {
          activeTurnId = await runAttempt(model);
          lastError = null;
          break;
        } catch (error: unknown) {
          const attemptError = error instanceof Error ? error : new Error("Deep Dive turn failed");
          lastError = attemptError;
          const canRetryCapacity = isModelCapacityError(attemptError.message)
            && accumulated.length === contentBeforeAttempt
            && (toolSession?.getAuditEvents().length ?? 0) === retrievalsBeforeAttempt
            && index < modelCandidates.length - 1;
          if (!canRetryCapacity) throw attemptError;
        }
      }
      if (lastError) throw lastError;
      if (!activeTurnId) throw new Error("Codex did not start a Deep Dive turn");

      this.persistToolSession(assistantRecord.id, toolSession);
      const completed = this.repository.updateMessage(assistantRecord.id, {
        content: accumulated,
        status: "completed",
        codexTurnId: activeTurnId,
      });
      const completedMessages = this.repository.listMessages(thread.id);
      const conversationSummary = buildConversationMemory(completedMessages);
      const autoTitle = isPlaceholderThreadTitle(thread.title) ? deriveThreadTitle(input.question) : thread.title;
      this.repository.updateThreadMetadata(thread.id, {
        title: autoTitle,
        conversationSummary,
      });
      onEvent({ type: "completed", message: this.toMessage(completed) });
    } catch (error: unknown) {
      this.persistToolSession(assistantRecord.id, toolSession);
      const message = error instanceof Error ? error.message : "Deep Dive turn failed";
      const current = this.repository.findMessageById(assistantRecord.id);
      if (current) {
        const status: "interrupted" | "error" = message.toLowerCase().includes("interrupt") ? "interrupted" : "error";
        this.repository.updateMessage(assistantRecord.id, {
          content: accumulated,
          status,
          ...(activeTurnId ? { codexTurnId: activeTurnId } : {}),
        });
      }
      onEvent({ type: "error", messageId: assistantRecord.id, message });
    } finally {
      this.activeTurnsByBook.delete(bookId);
      if (toolSession) this.activeBookToolsByCodexThread.delete(thread.codexThreadId);
    }
  }

  public async interruptBookTurn(bookId: string): Promise<boolean> {
    const active = this.activeTurnsByBook.get(bookId);
    if (!active) return false;
    await this.codex.interruptReaderTurn(active.codexThreadId, active.codexTurnId);
    return true;
  }

  private async ensureThread(bookId: string, requestedModel?: string, requestedThreadId?: string): Promise<ChatThreadRecord & { codexThreadId: string }> {
    const defaultModel = requestedModel ?? await this.resolveDefaultModel();
    const existing = requestedThreadId
      ? this.repository.findThreadById(requestedThreadId)
      : this.repository.findLatestThreadByBook(bookId);
    if (existing && existing.bookId !== bookId) throw new Error("Chat thread belongs to a different book");
    const contextToolsVersion = this.bookToolsEnabled ? BOOK_CONTEXT_TOOLS_VERSION : 0;
    const dynamicTools = this.bookToolsEnabled ? BOOK_TOOL_SPECS : [];

    if (!existing) {
      const codexThread = await this.codex.startReaderThread(defaultModel, dynamicTools);
      const now = new Date().toISOString();
      const created = this.repository.createThread({
        id: randomUUID(),
        bookId,
        codexThreadId: codexThread.thread.id,
        model: codexThread.model,
        contextToolsVersion,
        title: "新しいDeep Dive",
        conversationSummary: "",
        createdAt: now,
        updatedAt: now,
      });
      return { ...created, codexThreadId: codexThread.thread.id };
    }

    if (existing.codexThreadId && existing.contextToolsVersion >= contextToolsVersion) {
      try {
        await this.codex.ensureReaderThreadLoaded(existing.codexThreadId);
        return {
          ...existing,
          model: requestedModel ?? existing.model,
          codexThreadId: existing.codexThreadId,
        };
      } catch {
        // A persisted Codex rollout may have been removed. Recover locally without losing chat provenance.
      }
    }

    const replacement = await this.codex.startReaderThread(
      requestedModel ?? existing.model ?? defaultModel,
      dynamicTools,
    );
    const updated = this.repository.updateThreadCodexId(
      existing.id,
      replacement.thread.id,
      replacement.model,
      contextToolsVersion,
    );
    return { ...updated, codexThreadId: replacement.thread.id };
  }

  private async resolveModelCandidates(requestedModel?: string): Promise<string[]> {
    const models = await this.codex.listModels();
    const visible = models.data.filter((model) => !model.hidden).map((model) => model.id);
    const primary = requestedModel
      ?? models.data.find((model) => model.isDefault && !model.hidden)?.id
      ?? visible[0]
      ?? "gpt-5.6-sol";
    return [primary, ...visible.filter((model) => model !== primary)].slice(0, 3);
  }

  private async resolveDefaultModel(): Promise<string> {
    return (await this.resolveModelCandidates())[0] ?? "gpt-5.6-sol";
  }

  private handleNotification(
    notification: ServerNotificationEnvelope,
    codexThreadId: string,
    codexTurnId: string,
    onDelta: (delta: string) => void,
    onComplete: (status: string, errorMessage?: string) => void,
  ): void {
    if (notification.method === "item/agentMessage/delta") {
      const parsed = agentMessageDeltaParamsSchema.safeParse(notification.params);
      if (parsed.success && parsed.data.threadId === codexThreadId && parsed.data.turnId === codexTurnId) {
        onDelta(parsed.data.delta);
      }
      return;
    }

    if (notification.method === "turn/completed") {
      const parsed = turnCompletedParamsSchema.safeParse(notification.params);
      if (!parsed.success || parsed.data.threadId !== codexThreadId || parsed.data.turn.id !== codexTurnId) {
        return;
      }
      const rawError = parsed.data.turn.error;
      const errorMessage = rawError && typeof rawError === "object" && "message" in rawError
        ? String((rawError as { message?: unknown }).message ?? "")
        : undefined;
      onComplete(parsed.data.turn.status, errorMessage);
    }
  }

  private toMessage(record: ChatMessageRecord): ChatMessage {
    const sources = this.repository.listMessageSources(record.id).map((source) => ({
      label: source.sourceLabel,
      sourceAnchorId: source.sourceAnchorId,
      bookId: source.bookId,
      pageStart: source.pageStart,
      pageEnd: source.pageEnd,
      printedPageLabelStart: source.printedPageLabelStart,
      printedPageLabelEnd: source.printedPageLabelEnd,
      quoteRaw: source.quoteRaw,
      includedText: source.includedText ?? source.quoteRaw,
      truncated: source.truncated,
      origin: source.origin,
    }));
    const invalidCitationLabels = record.role === "assistant"
      ? findInvalidCitationLabels(record.content, sources.map((source) => source.label))
      : [];
    const retrievalEvents = record.role === "assistant"
      ? this.repository.listRetrievalEvents(record.id)
      : [];
    return chatMessageSchema.parse({ ...record, sources, invalidCitationLabels, retrievalEvents });
  }

  private async handleDynamicBookTool(request: DynamicToolCallParams) {
    const session = this.activeBookToolsByCodexThread.get(request.threadId);
    if (!session) {
      return {
        success: false,
        contentItems: [{
          type: "inputText" as const,
          text: "No active Deep Reader book context is available for this thread.",
        }],
      };
    }
    return session.handle(request);
  }

  private persistToolSession(assistantMessageId: string, toolSession: BookToolSession | null): void {
    if (!toolSession) return;
    this.repository.attachSources(assistantMessageId, toolSession.getSourceLinks());
    this.repository.createRetrievalEvents(
      assistantMessageId,
      toolSession.getAuditEvents().map((event) => ({ id: randomUUID(), ...event })),
    );
  }
}

function deriveExpansionCharacterBudget(contextWindowTokens: number | null | undefined): number {
  if (!contextWindowTokens) return 18_000;
  return Math.min(60_000, Math.max(18_000, Math.floor(contextWindowTokens * 0.08 * 4)));
}

function isPlaceholderThreadTitle(title: string): boolean {
  return title === "Deep Dive" || title === "新しいDeep Dive";
}

function deriveThreadTitle(question: string): string {
  const compact = question.replace(/\s+/gu, " ").trim();
  const firstSentence = compact.split(/[。.!?]/u)[0]?.trim() || compact;
  return firstSentence.slice(0, 60) || "Deep Dive";
}

function isModelCapacityError(message: string): boolean {
  return /(?:model|server).*(?:capacity|overloaded)|(?:capacity|overloaded).*model|try a different model/iu.test(message);
}
