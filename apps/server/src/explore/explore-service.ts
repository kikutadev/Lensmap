import { randomUUID } from "node:crypto";
import {
  exploreMessageSchema,
  workspaceExploreResponseSchema,
  type WorkspaceExploreResponse,
  type WorkspaceExploreThreadsResponse,
  type CreateExploreThreadRequest,
  type ExploreMessage,
  type ExploreTurnStreamEvent,
  type StartExploreTurnRequest,
} from "@lensmap/shared";
import type { ReaderDynamicToolHandler, ReaderDynamicToolSpec } from "../codex/app-server-client.js";
import {
  agentMessageDeltaParamsSchema,
  turnCompletedParamsSchema,
  type DynamicToolCallParams,
  type ServerNotificationEnvelope,
} from "../codex/protocol.js";
import type { BookContextGateway } from "../documents/book-context-gateway.js";
import type { MapService } from "../maps/map-service.js";
import type { WorkspaceService } from "../workspaces/workspace-service.js";
import { ExploreRepository, type ExploreMessageRecord, type ExploreThreadRecord } from "./explore-repository.js";
import { WorkspaceToolSession, WORKSPACE_TOOL_SPECS } from "./workspace-tool-session.js";
import { findInvalidCitationLabels } from "./citation-validator.js";
import { ContextBuilder } from "./context-builder.js";
import { buildConversationMemory } from "./conversation-memory.js";

export interface StreamExploreTurnOptions {
  workspaceId: string;
  input: StartExploreTurnRequest;
  onEvent: (event: ExploreTurnStreamEvent) => void;
}

export interface ReaderCodexClient {
  listModels(): Promise<{ data: Array<{ id: string; hidden: boolean; isDefault: boolean; inputModalities?: Array<"text" | "image" | "audio"> }> }>;
  startReaderThread(model: string, dynamicTools?: ReaderDynamicToolSpec[]): Promise<{ thread: { id: string }; model: string }>;
  ensureReaderThreadLoaded(threadId: string): Promise<void>;
  startReaderTurn(options: { threadId: string; text: string; localImages?: Array<{ label: string; path: string }>; model?: string; effort?: "low" | "medium" | "high" | "xhigh" | "max" | "ultra" }): Promise<{ turn: { id: string; status: string } }>;
  interruptReaderTurn(threadId: string, turnId: string): Promise<void>;
  onNotification(listener: (notification: ServerNotificationEnvelope) => void): () => void;
  setDynamicToolHandler?(handler: ReaderDynamicToolHandler | null): void;
  getModelContextWindowTokens?(): number | null;
}

interface ActiveTurn {
  workspaceId: string;
  codexThreadId: string;
  codexTurnId: string;
  assistantMessageId: string;
}

const TURN_COMPLETION_TIMEOUT_MS = 10 * 60 * 1000;
const WORKSPACE_CONTEXT_TOOLS_VERSION = 4;

/** Coordinate Workspace sources, local provenance, bounded multi-PDF retrieval, and Codex streaming. */
export class ExploreService {
  private readonly activeTurnsByWorkspace = new Map<string, ActiveTurn>();
  private readonly activeWorkspaceToolsByCodexThread = new Map<string, WorkspaceToolSession>();
  private readonly workspaceToolsEnabled: boolean;

  public constructor(
    private readonly repository: ExploreRepository,
    private readonly workspaceService: WorkspaceService,
    private readonly codex: ReaderCodexClient,
    private readonly bookContextGateway?: BookContextGateway,
    private readonly mapService?: Pick<MapService, "createFromMessage">,
    private readonly contextBuilder = new ContextBuilder(),
  ) {
    this.workspaceToolsEnabled = Boolean(bookContextGateway && codex.setDynamicToolHandler);
    if (this.workspaceToolsEnabled) this.codex.setDynamicToolHandler?.((request) => this.handleDynamicWorkspaceTool(request));
  }

  public getWorkspaceExplore(workspaceId: string, threadId?: string): WorkspaceExploreResponse {
    this.workspaceService.get(workspaceId);
    const thread = threadId ? this.repository.findThreadById(threadId) : this.repository.findLatestThreadByWorkspace(workspaceId);
    if (!thread) return workspaceExploreResponseSchema.parse({ thread: null });
    if (thread.workspaceId !== workspaceId) throw new Error("Explore thread belongs to a different workspace");
    return workspaceExploreResponseSchema.parse({
      thread: { ...thread, messages: this.repository.listMessages(thread.id).map((message) => this.toMessage(message)) },
    });
  }

  public listWorkspaceThreads(workspaceId: string): WorkspaceExploreThreadsResponse {
    this.workspaceService.get(workspaceId);
    return {
      threads: this.repository.listThreadsByWorkspace(workspaceId).map((thread) => ({
        id: thread.id,
        workspaceId: thread.workspaceId,
        codexThreadId: thread.codexThreadId,
        model: thread.model,
        title: thread.title,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        messageCount: this.repository.listMessages(thread.id).length,
      })),
    };
  }

  public async createWorkspaceThread(workspaceId: string, input: CreateExploreThreadRequest): Promise<WorkspaceExploreResponse> {
    const workspace = this.workspaceService.get(workspaceId);
    const originBookId = workspace.sources[0]?.bookId ?? workspace.books[0]?.id;
    if (!originBookId) throw new Error("Workspace has no documents");
    const model = input.model ?? await this.resolveDefaultModel();
    const now = new Date().toISOString();
    const created = this.repository.createThread({
      id: randomUUID(),
      workspaceId,
      originBookId,
      codexThreadId: null,
      model,
      contextToolsVersion: this.workspaceToolsEnabled ? WORKSPACE_CONTEXT_TOOLS_VERSION : 0,
      title: input.title?.trim() || "新しい会話",
      conversationSummary: "",
      createdAt: now,
      updatedAt: now,
    });
    return workspaceExploreResponseSchema.parse({ thread: { ...created, messages: [] } });
  }

  public async streamTurn({ workspaceId, input, onEvent }: StreamExploreTurnOptions): Promise<void> {
    const workspace = this.workspaceService.get(workspaceId);
    if (this.activeTurnsByWorkspace.has(workspaceId)) throw new Error("A turn is already running for this workspace");

    const anchors = this.workspaceService.getOrderedSources(workspaceId, input.sourceIds);
    const visualSources = anchors.filter((source) => source.kind === "visual");
    const modelCandidates = await this.resolveModelCandidates(input.model, visualSources.length > 0);
    const thread = await this.ensureThread(workspaceId, modelCandidates[0], input.threadId);
    const bookTitles = new Map(workspace.books.map((book) => [book.id, book.title]));
    const context = this.contextBuilder.build(input.question, anchors, thread.conversationSummary, bookTitles);
    const localImages = context.sources.flatMap(({ label, source }) => source.kind === "visual"
      ? [{ label, path: this.workspaceService.resolveVisualAssetPath(source.bookId, source.imageAssetId) }]
      : []);
    const toolSession = this.workspaceToolsEnabled && this.bookContextGateway
      ? new WorkspaceToolSession({
        workspaceId,
        books: workspace.books.map((book) => ({ id: book.id, title: book.title })),
        explicitSources: context.sources.map(({ label, source }) => ({ label, source })),
        gateway: this.bookContextGateway,
        limits: { maxRetrievedCharacters: deriveExpansionCharacterBudget(this.codex.getModelContextWindowTokens?.()) },
      })
      : null;
    if (toolSession) this.activeWorkspaceToolsByCodexThread.set(thread.codexThreadId, toolSession);

    const sourceLinks = context.sources.map(({ label, source, includedText, truncated }, index) => ({
      sourceAnchorId: source.id, sourceLabel: label, sourceOrder: index, includedText, truncated,
    }));
    const timestamp = new Date().toISOString();
    const userRecord = this.repository.createMessage({
      id: randomUUID(), threadId: thread.id, role: "user", content: input.question.trim(), status: "completed",
      codexTurnId: null, createdAt: timestamp, updatedAt: timestamp,
    });
    const assistantRecord = this.repository.createMessage({
      id: randomUUID(), threadId: thread.id, role: "assistant", content: "", status: "streaming",
      codexTurnId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
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
      const completion = new Promise<void>((resolve, reject) => { completionResolve = resolve; completionReject = reject; });
      const unsubscribe = this.codex.onNotification((notification) => {
        if (!attemptTurnId) return;
        this.handleNotification(notification, thread.codexThreadId, attemptTurnId, (delta) => {
          accumulated += delta;
          onEvent({ type: "delta", messageId: assistantRecord.id, delta });
        }, (status, errorMessage) => {
          if (status === "completed") completionResolve?.();
          else completionReject?.(new Error(errorMessage ?? `Codex turn ended with status ${status}`));
        });
      });
      const timeout = setTimeout(() => completionReject?.(new Error("Codex turn timed out")), TURN_COMPLETION_TIMEOUT_MS);
      try {
        const turnResponse = await this.codex.startReaderTurn({ threadId: thread.codexThreadId, text: context.prompt, localImages, model, effort: "high" });
        attemptTurnId = turnResponse.turn.id;
        activeTurnId = attemptTurnId;
        this.activeTurnsByWorkspace.set(workspaceId, {
          workspaceId, codexThreadId: thread.codexThreadId, codexTurnId: attemptTurnId, assistantMessageId: assistantRecord.id,
        });
        const updatedUser = this.repository.updateMessage(userRecord.id, { codexTurnId: attemptTurnId });
        const updatedAssistant = this.repository.updateMessage(assistantRecord.id, { codexTurnId: attemptTurnId });
        onEvent({
          type: "turn-started", threadId: thread.id, codexThreadId: thread.codexThreadId, codexTurnId: attemptTurnId,
          userMessage: this.toMessage(updatedUser), assistantMessage: this.toMessage(updatedAssistant),
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
      let successfulModel = thread.model;
      for (let index = 0; index < modelCandidates.length; index += 1) {
        const model = modelCandidates[index];
        if (!model) continue;
        const contentBeforeAttempt = accumulated.length;
        const retrievalsBeforeAttempt = toolSession?.getAuditEvents().length ?? 0;
        try {
          activeTurnId = await runAttempt(model);
          successfulModel = model;
          lastError = null;
          break;
        } catch (error: unknown) {
          const attemptError = error instanceof Error ? error : new Error("Explore turn failed");
          lastError = attemptError;
          const canRetryCapacity = isModelCapacityError(attemptError.message)
            && accumulated.length === contentBeforeAttempt
            && (toolSession?.getAuditEvents().length ?? 0) === retrievalsBeforeAttempt
            && index < modelCandidates.length - 1;
          if (!canRetryCapacity) throw attemptError;
        }
      }
      if (lastError) throw lastError;
      if (!activeTurnId) throw new Error("Codex did not start an Explore turn");

      this.persistToolSession(assistantRecord.id, toolSession);
      const completed = this.repository.updateMessage(assistantRecord.id, { content: accumulated, status: "completed", codexTurnId: activeTurnId });
      const completedMessages = this.repository.listMessages(thread.id);
      this.repository.updateThreadMetadata(thread.id, {
        title: isPlaceholderThreadTitle(thread.title) ? deriveThreadTitle(input.question) : thread.title,
        conversationSummary: buildConversationMemory(completedMessages),
        model: successfulModel,
      });
      try { this.mapService?.createFromMessage({ messageId: completed.id }); } catch {
        // Map persistence is intentionally isolated from a successful Explore response.
      }
      onEvent({ type: "completed", message: this.toMessage(completed) });
    } catch (error: unknown) {
      this.persistToolSession(assistantRecord.id, toolSession);
      const message = error instanceof Error ? error.message : "Explore turn failed";
      const current = this.repository.findMessageById(assistantRecord.id);
      if (current) {
        const status: "interrupted" | "error" = message.toLowerCase().includes("interrupt") ? "interrupted" : "error";
        this.repository.updateMessage(assistantRecord.id, { content: accumulated, status, ...(activeTurnId ? { codexTurnId: activeTurnId } : {}) });
      }
      onEvent({ type: "error", messageId: assistantRecord.id, message });
    } finally {
      this.activeTurnsByWorkspace.delete(workspaceId);
      if (toolSession) this.activeWorkspaceToolsByCodexThread.delete(thread.codexThreadId);
    }
  }

  public async interruptWorkspaceTurn(workspaceId: string): Promise<boolean> {
    const active = this.activeTurnsByWorkspace.get(workspaceId);
    if (!active) return false;
    await this.codex.interruptReaderTurn(active.codexThreadId, active.codexTurnId);
    return true;
  }

  private async ensureThread(workspaceId: string, requestedModel?: string, requestedThreadId?: string): Promise<ExploreThreadRecord & { codexThreadId: string }> {
    const workspace = this.workspaceService.get(workspaceId);
    const originBookId = workspace.sources[0]?.bookId ?? workspace.books[0]?.id;
    if (!originBookId) throw new Error("Workspace has no documents");
    const defaultModel = requestedModel ?? await this.resolveDefaultModel();
    const existing = requestedThreadId ? this.repository.findThreadById(requestedThreadId) : this.repository.findLatestThreadByWorkspace(workspaceId);
    if (existing && existing.workspaceId !== workspaceId) throw new Error("Explore thread belongs to a different workspace");
    const contextToolsVersion = this.workspaceToolsEnabled ? WORKSPACE_CONTEXT_TOOLS_VERSION : 0;
    const dynamicTools = this.workspaceToolsEnabled ? WORKSPACE_TOOL_SPECS : [];

    if (!existing) {
      const codexThread = await this.codex.startReaderThread(defaultModel, dynamicTools);
      const now = new Date().toISOString();
      const created = this.repository.createThread({
        id: randomUUID(), workspaceId, originBookId, codexThreadId: codexThread.thread.id, model: codexThread.model,
        contextToolsVersion, title: "新しい会話", conversationSummary: "", createdAt: now, updatedAt: now,
      });
      return { ...created, codexThreadId: codexThread.thread.id };
    }

    if (existing.codexThreadId && existing.contextToolsVersion >= contextToolsVersion) {
      try {
        await this.codex.ensureReaderThreadLoaded(existing.codexThreadId);
        return { ...existing, model: requestedModel ?? existing.model, codexThreadId: existing.codexThreadId };
      } catch {
        // Recover a removed Codex rollout without discarding local Explore history or provenance.
      }
    }

    const replacement = await this.codex.startReaderThread(requestedModel ?? existing.model ?? defaultModel, dynamicTools);
    const updated = this.repository.updateThreadCodexId(existing.id, replacement.thread.id, replacement.model, contextToolsVersion);
    return { ...updated, codexThreadId: replacement.thread.id };
  }

  private async resolveModelCandidates(requestedModel?: string, requiresImage = false): Promise<string[]> {
    const models = await this.codex.listModels();
    const visibleModels = models.data.filter((model) => !model.hidden);
    if (requiresImage && requestedModel) {
      const requested = visibleModels.find((model) => model.id === requestedModel);
      if (!requested || !supportsImageInput(requested)) {
        throw new Error(`Visual Sourceを利用するには画像入力対応モデルを選択してください: ${requestedModel}`);
      }
    }
    const eligible = requiresImage ? visibleModels.filter(supportsImageInput) : visibleModels;
    if (requiresImage && eligible.length === 0) {
      throw new Error("Visual Sourceを利用できる画像入力対応Codexモデルがありません");
    }
    const visible = eligible.map((model) => model.id);
    const primary = requestedModel
      ?? eligible.find((model) => model.isDefault)?.id
      ?? visible[0]
      ?? "gpt-5.6-sol";
    return [primary, ...visible.filter((model) => model !== primary)].slice(0, 3);
  }

  private async resolveDefaultModel(): Promise<string> { return (await this.resolveModelCandidates())[0] ?? "gpt-5.6-sol"; }

  private handleNotification(
    notification: ServerNotificationEnvelope,
    codexThreadId: string,
    codexTurnId: string,
    onDelta: (delta: string) => void,
    onComplete: (status: string, errorMessage?: string) => void,
  ): void {
    if (notification.method === "item/agentMessage/delta") {
      const parsed = agentMessageDeltaParamsSchema.safeParse(notification.params);
      if (parsed.success && parsed.data.threadId === codexThreadId && parsed.data.turnId === codexTurnId) onDelta(parsed.data.delta);
      return;
    }
    if (notification.method === "turn/completed") {
      const parsed = turnCompletedParamsSchema.safeParse(notification.params);
      if (!parsed.success || parsed.data.threadId !== codexThreadId || parsed.data.turn.id !== codexTurnId) return;
      const rawError = parsed.data.turn.error;
      const errorMessage = rawError && typeof rawError === "object" && "message" in rawError
        ? String((rawError as { message?: unknown }).message ?? "") : undefined;
      onComplete(parsed.data.turn.status, errorMessage);
    }
  }

  private toMessage(record: ExploreMessageRecord): ExploreMessage {
    const sources = this.repository.listMessageSources(record.id).map((source) => source.kind === "visual"
      ? {
        kind: "visual" as const,
        label: source.sourceLabel, sourceAnchorId: source.sourceAnchorId, bookId: source.bookId, bookTitle: source.bookTitle,
        imageAssetId: source.imageAssetId!, locationStatus: source.locationStatus ?? "unresolved", page: source.visualPage,
        recognizedText: source.recognizedText, includedText: source.includedText ?? source.recognizedText ?? "",
        truncated: source.truncated, origin: source.origin,
      }
      : {
        kind: "text" as const,
        label: source.sourceLabel, sourceAnchorId: source.sourceAnchorId, bookId: source.bookId, bookTitle: source.bookTitle,
        pageStart: source.pageStart, pageEnd: source.pageEnd, printedPageLabelStart: source.printedPageLabelStart,
        printedPageLabelEnd: source.printedPageLabelEnd, quoteRaw: source.quoteRaw, includedText: source.includedText ?? source.quoteRaw,
        truncated: source.truncated, origin: source.origin,
      });
    const invalidCitationLabels = record.role === "assistant" ? findInvalidCitationLabels(record.content, sources.map((source) => source.label)) : [];
    const retrievalEvents = record.role === "assistant" ? this.repository.listRetrievalEvents(record.id) : [];
    return exploreMessageSchema.parse({ ...record, sources, invalidCitationLabels, retrievalEvents });
  }

  private async handleDynamicWorkspaceTool(request: DynamicToolCallParams) {
    const session = this.activeWorkspaceToolsByCodexThread.get(request.threadId);
    if (!session) return { success: false, contentItems: [{ type: "inputText" as const, text: "No active Lensmap Reader Workspace is available for this thread." }] };
    return session.handle(request);
  }

  private persistToolSession(assistantMessageId: string, toolSession: WorkspaceToolSession | null): void {
    if (!toolSession) return;
    this.repository.attachSources(assistantMessageId, toolSession.getSourceLinks());
    this.repository.createRetrievalEvents(assistantMessageId, toolSession.getAuditEvents().map((event) => ({ id: randomUUID(), ...event })));
  }
}

function deriveExpansionCharacterBudget(contextWindowTokens: number | null | undefined): number {
  if (!contextWindowTokens) return 24_000;
  return Math.min(72_000, Math.max(24_000, Math.floor(contextWindowTokens * 0.08 * 4)));
}

function isPlaceholderThreadTitle(title: string): boolean { return title === "Deep Dive" || title === "新しいDeep Dive" || title === "新しい会話"; }
function deriveThreadTitle(question: string): string {
  const compact = question.replace(/\s+/gu, " ").trim();
  const firstSentence = compact.split(/[。.!?]/u)[0]?.trim() || compact;
  return firstSentence.slice(0, 60) || "Explore";
}
function isModelCapacityError(message: string): boolean {
  return /(?:model|server).*(?:capacity|overloaded)|(?:capacity|overloaded).*model|try a different model/iu.test(message);
}

function supportsImageInput(model: { inputModalities?: Array<"text" | "image" | "audio"> }): boolean {
  return model.inputModalities?.includes("image") === true;
}
