import type { ChatMessage, InsightArtifactSummary } from "@deep-reader/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpenText,
  Check,
  ChevronRight,
  CircleAlert,
  FileText,
  LibraryBig,
  LoaderCircle,
  MessageSquareText,
  Plus,
  Save,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { browser } from "wxt/browser";
import {
  createBookChatThread,
  createInsightFromMessage,
  fetchBookChat,
  fetchBookChatThreads,
  fetchCodexStatus,
  fetchInsights,
  streamChatTurn,
} from "../../lib/api";
import {
  clearLastAssistant,
  getLastAssistant,
  getTabState,
  isDeepReaderStorageChange,
  patchTabState,
  setLastAssistant,
  type DeepReaderTabState,
} from "../../lib/state";
import { requestServerStartup } from "../../lib/request-server-startup";
import { InsightDetail } from "./InsightDetail";
import { RichMessage } from "./rich/RichMessage";
import { useSidePanelStore } from "./store";

export function App() {
  useActiveTabState();
  const view = useSidePanelStore((state) => state.view);
  const setView = useSidePanelStore((state) => state.setView);
  const tabState = useSidePanelStore((state) => state.tabState);
  const codex = useQuery({
    queryKey: ["codex-status"],
    queryFn: async ({ signal }) => {
      await requestServerStartup(signal);
      return fetchCodexStatus(signal);
    },
    refetchInterval: 60_000,
  });
  const connectionMessage = codex.isError
    ? codex.error instanceof Error
      ? codex.error.message
      : "Deep Reader Serverに接続できません。"
    : codex.data && !codex.data.ready
      ? codex.data.error ?? "Codex App Serverに接続できません。"
      : null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon"><BookOpenText size={16} /></span>
          <div>
            <strong>Deep Reader</strong>
            <span>Chrome PDF + grounded Codex</span>
          </div>
        </div>
        <CodexBadge status={codex.data?.ready ? "ready" : codex.isLoading ? "loading" : "offline"} />
      </header>

      <nav className="view-tabs" aria-label="Deep Reader views">
        <button className={view === "chat" ? "active" : ""} onClick={() => setView("chat")}>
          <MessageSquareText size={14} />Chat
        </button>
        <button className={view === "insights" ? "active" : ""} onClick={() => setView("insights")} disabled={!tabState?.bookId}>
          <LibraryBig size={14} />Insights
        </button>
      </nav>

      <main className="app-main">
        {connectionMessage ? (
          <ConnectionNotice
            message={connectionMessage}
            retrying={codex.isFetching}
            onRetry={() => { void codex.refetch(); }}
          />
        ) : null}
        {!tabState || tabState.status === "idle" ? <EmptyState /> : null}
        {tabState && tabState.status !== "idle" ? (
          view === "chat"
            ? <ChatView key={`chat:${tabState.tabId}:${tabState.pdfUrl ?? "none"}`} state={tabState} />
            : <InsightsView key={`insights:${tabState.tabId}:${tabState.pdfUrl ?? "none"}`} state={tabState} />
        ) : null}
      </main>
    </div>
  );
}

function CodexBadge({ status }: { status: "ready" | "loading" | "offline" }) {
  if (status === "ready") return <span className="codex-badge ready"><Check size={12} />Codex</span>;
  if (status === "loading") return <span className="codex-badge"><LoaderCircle className="spin" size={12} />確認中</span>;
  return <span className="codex-badge offline"><CircleAlert size={12} />未接続</span>;
}

function ConnectionNotice({ message, retrying, onRetry }: { message: string; retrying: boolean; onRetry: () => void }) {
  return (
    <div className="connection-notice" role="status">
      <CircleAlert size={15} />
      <div>
        <strong>Deep Readerを起動できませんでした</strong>
        <span>{message}</span>
        <small>通常は自動起動します。初回セットアップ後も失敗する場合はNative Hostの登録状態を確認してください。</small>
        <button className="secondary-button" disabled={retrying} onClick={onRetry}>
          {retrying ? <LoaderCircle className="spin" size={13} /> : null}
          再接続
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="empty-state">
      <BookOpenText size={30} />
      <h1>PDFを読みながら深掘り</h1>
      <p>Chrome標準PDFビューアで本文を選択し、右クリックしてください。</p>
      <div className="instruction-card">
        <strong>Deep Readerで深掘り</strong>
        <span>Side Panelをすぐ開き、選択箇所をSourceに追加して質問欄へフォーカスします。</span>
      </div>
      <div className="instruction-card">
        <strong>Deep Readerの引用に追加</strong>
        <span>複数箇所を集めてからまとめて質問できます。</span>
      </div>
    </section>
  );
}

function ChatView({ state }: { state: DeepReaderTabState }) {
  const queryClient = useQueryClient();
  const tabKey = String(state.tabId);
  const lastAssistant = useSidePanelStore((store) => store.lastAssistant);
  const streamingContent = useSidePanelStore((store) => store.transientByTab[tabKey]?.streamingContent ?? "");
  const streamStatus = useSidePanelStore((store) => store.transientByTab[tabKey]?.streamStatus ?? "idle");
  const question = useSidePanelStore((store) => store.transientByTab[tabKey]?.composerDraft ?? "");
  const actionError = useSidePanelStore((store) => store.transientByTab[tabKey]?.actionError ?? null);
  const setStreamState = useSidePanelStore((store) => store.setStreamState);
  const appendStreamingContent = useSidePanelStore((store) => store.appendStreamingContent);
  const setComposerDraft = useSidePanelStore((store) => store.setComposerDraft);
  const setActionError = useSidePanelStore((store) => store.setActionError);
  const setLastAssistantMessage = useSidePanelStore((store) => store.setLastAssistant);
  const streaming = streamStatus === "streaming";
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusRequest = useRef(state.composerFocusRequest);

  const chat = useQuery({
    queryKey: ["book-chat", state.bookId, state.threadId],
    queryFn: ({ signal }) => fetchBookChat(state.bookId!, state.threadId ?? undefined, signal),
    enabled: Boolean(state.bookId),
  });
  const threads = useQuery({
    queryKey: ["book-chat-threads", state.bookId],
    queryFn: ({ signal }) => fetchBookChatThreads(state.bookId!, signal),
    enabled: Boolean(state.bookId),
  });
  const createThread = useMutation({
    mutationFn: () => createBookChatThread(state.bookId!),
    onSuccess: async (result) => {
      const id = result.thread?.id ?? null;
      await Promise.all([
        patchTabState(state.tabId, { threadId: id }),
        clearLastAssistant(state.tabId),
      ]);
      setLastAssistantMessage(null);
      setActionError(state.tabId, null);
      if (id) await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["book-chat-threads", state.bookId] }),
        queryClient.invalidateQueries({ queryKey: ["book-chat", state.bookId] }),
      ]);
    },
  });

  useEffect(() => {
    if (state.composerFocusRequest === lastFocusRequest.current) return;
    lastFocusRequest.current = state.composerFocusRequest;
    questionRef.current?.focus();
  }, [state.composerFocusRequest]);

  const messages = chat.data?.thread?.messages ?? [];
  const displayedMessages = useMemo(() => {
    if (!streamingContent) return messages;
    const assistant: ChatMessage = {
      id: `transient:${state.tabId}`,
      threadId: state.threadId ?? "streaming",
      role: "assistant",
      content: streamingContent,
      status: streamStatus === "error" ? "error" : "streaming",
      codexTurnId: null,
      sources: [],
      invalidCitationLabels: [],
      retrievalEvents: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return [...messages.filter((message) => message.id !== assistant.id), assistant];
  }, [messages, state.tabId, state.threadId, streamStatus, streamingContent]);

  const send = async () => {
    const trimmed = question.trim();
    if (!trimmed || !state.bookId || state.sources.length === 0 || streaming) return;
    setActionError(state.tabId, null);
    setLastAssistantMessage(null);
    setStreamState(state.tabId, "streaming", "");
    try {
      await streamChatTurn(
        {
          bookId: state.bookId,
          question: trimmed,
          sourceIds: state.sources.map((source) => source.id),
          threadId: state.threadId,
        },
        (event) => {
          if (event.type === "turn-started") {
            void patchTabState(state.tabId, { threadId: event.threadId });
            setStreamState(state.tabId, "streaming", "");
          } else if (event.type === "delta") {
            appendStreamingContent(state.tabId, event.delta);
          } else if (event.type === "completed") {
            setStreamState(state.tabId, "idle", "");
            setLastAssistantMessage(event.message);
            void setLastAssistant(state.tabId, event.message);
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        },
      );
      setComposerDraft(state.tabId, "");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["book-chat", state.bookId] }),
        queryClient.invalidateQueries({ queryKey: ["book-chat-threads", state.bookId] }),
      ]);
    } catch (error) {
      setStreamState(state.tabId, "error", `エラー: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const switchThread = async (threadId: string | null) => {
    await Promise.all([
      patchTabState(state.tabId, { threadId }),
      clearLastAssistant(state.tabId),
    ]);
    setLastAssistantMessage(null);
    setStreamState(state.tabId, "idle", "");
    setActionError(state.tabId, null);
  };

  return (
    <div className="chat-view">
      <div className="thread-toolbar">
        <select
          aria-label="Deep Dive chat"
          value={state.threadId ?? chat.data?.thread?.id ?? ""}
          onChange={(event) => { void switchThread(event.target.value || null); }}
        >
          {!threads.data?.threads.length ? <option value="">最初のDeep Dive</option> : null}
          {threads.data?.threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title}</option>)}
        </select>
        <button className="secondary-button" disabled={createThread.isPending} onClick={() => createThread.mutate()} aria-label="新しいDeep Dive">
          {createThread.isPending ? <LoaderCircle className="spin" size={13} /> : <Plus size={13} />}新規
        </button>
      </div>
      <CaptureStatus state={state} />
      {actionError ? <ActionError tabId={state.tabId} message={actionError} /> : null}
      <SourceList state={state} />
      {state.status === "ambiguous" ? <AmbiguousCandidates state={state} /> : null}

      <section className="messages" aria-live="polite">
        {displayedMessages.length === 0 ? (
          <div className="message-placeholder">Sourceを添付して質問すると、書籍内だけを追加探索しながら回答します。</div>
        ) : displayedMessages.map((message) => (
          <MessageCard key={message.id} message={message} tabId={state.tabId} />
        ))}
      </section>

      {lastAssistant?.status === "completed" && lastAssistant.threadId === state.threadId
        ? <SaveInsightButton message={lastAssistant} bookId={state.bookId} />
        : null}

      <section className="composer">
        <textarea
          ref={questionRef}
          value={question}
          onChange={(event) => setComposerDraft(state.tabId, event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="選択箇所について質問…"
          aria-label="質問"
          disabled={streaming || state.sources.length === 0}
        />
        <div className="composer-footer">
          <span>⌘/Ctrl + Enter</span>
          <button disabled={streaming || !question.trim() || state.sources.length === 0} onClick={() => void send()}>
            {streaming ? <LoaderCircle className="spin" size={14} /> : <ChevronRight size={14} />}
            送信
          </button>
        </div>
      </section>
    </div>
  );
}

function CaptureStatus({ state }: { state: DeepReaderTabState }) {
  if (state.status === "ready") return null;
  const labels: Record<DeepReaderTabState["status"], string> = {
    idle: "待機中",
    importing: "PDFをDeep Readerへ取り込み中…",
    resolving: "選択箇所をPDFページへ再同定中…",
    ambiguous: "同じ選択文が複数箇所にあります",
    ready: "準備完了",
    error: state.error ?? "エラー",
  };
  const cancellable = state.status === "importing" || state.status === "resolving";
  return (
    <div className={`capture-status ${state.status === "error" ? "error" : ""}`}>
      {state.status === "error" ? <CircleAlert size={15} /> : <LoaderCircle className={state.status === "ambiguous" ? "" : "spin"} size={15} />}
      <span>{labels[state.status]}</span>
      {cancellable ? <button className="text-button" onClick={() => void cancelCapture(state.tabId)}>キャンセル</button> : null}
    </div>
  );
}

function ActionError({ tabId, message }: { tabId: number; message: string }) {
  const setActionError = useSidePanelStore((store) => store.setActionError);
  return (
    <div className="action-error" role="alert">
      <CircleAlert size={14} />
      <span>{message}</span>
      <button className="icon-button" aria-label="エラーを閉じる" onClick={() => setActionError(tabId, null)}><X size={13} /></button>
    </div>
  );
}

function SourceList({ state }: { state: DeepReaderTabState }) {
  if (state.sources.length === 0) return null;
  const removeSource = async (sourceId: string) => {
    await patchTabState(state.tabId, { sources: state.sources.filter((source) => source.id !== sourceId) });
  };
  const clearAll = async () => patchTabState(state.tabId, { sources: [] });

  return (
    <section className="source-section">
      <div className="section-heading">
        <div><FileText size={14} /><strong>Sources</strong><span>{state.sources.length}</span></div>
        <button className="text-button" onClick={() => void clearAll()}>すべて外す</button>
      </div>
      <div className="source-list">
        {state.sources.map((source, index) => (
          <article className="source-card" key={source.id}>
            <button className="source-main" onClick={() => void requestCitation(state.tabId, source.pageStart + 1)}>
              <span className="source-label">S{index + 1} · PDF p.{source.pageStart + 1}{source.pageEnd > source.pageStart ? `–${source.pageEnd + 1}` : ""}</span>
              <span className="source-quote">{source.quoteRaw}</span>
            </button>
            <button className="icon-button" aria-label="引用を外す" onClick={() => void removeSource(source.id)}><X size={14} /></button>
          </article>
        ))}
      </div>
    </section>
  );
}

function AmbiguousCandidates({ state }: { state: DeepReaderTabState }) {
  return (
    <section className="candidate-section">
      <div className="section-heading"><div><CircleAlert size={14} /><strong>引用箇所を選択</strong></div></div>
      <p>同じ文章が複数箇所にあります。読んでいた位置を選んでください。</p>
      <div className="candidate-list">
        {state.resolutionCandidates.map((candidate, index) => (
          <button
            key={`${candidate.pageStart}-${candidate.pageEnd}-${index}`}
            onClick={() => void resolveCandidate(state.tabId, index)}
          >
            <strong>PDF p.{candidate.pageStart + 1}{candidate.pageEnd > candidate.pageStart ? `–${candidate.pageEnd + 1}` : ""}</strong>
            <span>{candidate.prefix ? `…${candidate.prefix.slice(-64)}` : ""}<mark>{candidate.quoteRaw.slice(0, 120)}</mark>{candidate.suffix ? `${candidate.suffix.slice(0, 64)}…` : ""}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function MessageCard({ message, tabId }: { message: ChatMessage; tabId: number }) {
  const usedSources = message.role === "assistant"
    ? message.sources.filter((source) => message.content.includes(`[${source.label}]`))
    : message.sources;
  const stateLabel = message.status === "streaming" ? " · 生成中" : message.status === "error" ? " · エラー" : "";
  return (
    <article className={`message ${message.role} ${message.status === "error" ? "error" : ""}`}>
      <div className="message-meta">{message.role === "user" ? "You" : "Codex"}{stateLabel}</div>
      <div className="message-content">{message.role === "assistant" ? <RichMessage markdown={message.content} sources={message.sources} onOpenSource={(source) => void requestCitation(tabId, source.pageStart + 1)} /> : message.content}</div>
      {usedSources.length > 0 ? (
        <div className="citation-row">
          {usedSources.map((source) => (
            <button key={`${message.id}-${source.label}`} onClick={() => void requestCitation(tabId, source.pageStart + 1)}>
              {source.label} · PDF p.{source.pageStart + 1}
              {source.origin === "ai-expansion" ? <span>AI追加</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {message.retrievalEvents.length > 0 ? (
        <details className="retrieval-audit">
          <summary>AI参照履歴 · {message.retrievalEvents.length}</summary>
          {message.retrievalEvents.map((event) => <div key={event.id}><strong>{event.toolName}</strong><span>{JSON.stringify(event.resultSummary)}</span></div>)}
        </details>
      ) : null}
    </article>
  );
}

function SaveInsightButton({ message, bookId }: { message: ChatMessage; bookId: string | null }) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => createInsightFromMessage(message.id),
    onSuccess: async () => {
      if (bookId) await queryClient.invalidateQueries({ queryKey: ["insights", bookId] });
    },
  });
  return (
    <button className="save-insight" disabled={save.isPending || save.isSuccess} onClick={() => save.mutate()}>
      {save.isPending ? <LoaderCircle className="spin" size={14} /> : save.isSuccess ? <Check size={14} /> : <Save size={14} />}
      {save.isSuccess ? "Insight保存済み" : "回答をInsightに保存"}
    </button>
  );
}

function InsightsView({ state }: { state: DeepReaderTabState }) {
  const tabKey = String(state.tabId);
  const selectedInsightId = useSidePanelStore((store) => store.transientByTab[tabKey]?.selectedInsightId ?? null);
  const setSelectedInsightId = useSidePanelStore((store) => store.setSelectedInsightId);
  const insights = useQuery({
    queryKey: ["insights", state.bookId],
    queryFn: ({ signal }) => fetchInsights(state.bookId!, signal),
    enabled: Boolean(state.bookId),
  });

  if (selectedInsightId) {
    return <InsightDetail artifactId={selectedInsightId} onBack={() => setSelectedInsightId(state.tabId, null)} onOpenPage={(page) => void requestCitation(state.tabId, page)} />;
  }

  return (
    <div className="insight-list-view">
      <div className="section-heading"><div><LibraryBig size={14} /><strong>Insights</strong><span>{insights.data?.artifacts.length ?? 0}</span></div></div>
      {insights.isLoading ? <LoaderBlock label="Insightsを読み込み中…" /> : null}
      {insights.data?.artifacts.length === 0 ? <div className="message-placeholder">保存したInsightはここに蓄積されます。</div> : null}
      <div className="insight-list">
        {insights.data?.artifacts.map((artifact) => (
          <InsightListItem key={artifact.id} artifact={artifact} onOpen={() => setSelectedInsightId(state.tabId, artifact.id)} />
        ))}
      </div>
    </div>
  );
}

function InsightListItem({ artifact, onOpen }: { artifact: InsightArtifactSummary; onOpen: () => void }) {
  return (
    <button className="insight-list-item" onClick={onOpen}>
      <div>
        <strong>{artifact.title}</strong>
        <span>{artifact.kind} · v{artifact.version} · {artifact.sourceCount} refs</span>
      </div>
      <ChevronRight size={16} />
    </button>
  );
}

function LoaderBlock({ label }: { label: string }) {
  return <div className="loader-block"><LoaderCircle className="spin" size={15} />{label}</div>;
}

async function requestCitation(tabId: number, page: number): Promise<void> {
  await sendRuntimeRequest(tabId, { type: "open-citation", tabId, page });
}

async function resolveCandidate(tabId: number, candidateIndex: number): Promise<void> {
  await sendRuntimeRequest(tabId, { type: "resolve-selection-candidate", tabId, candidateIndex });
}

async function cancelCapture(tabId: number): Promise<void> {
  await sendRuntimeRequest(tabId, { type: "cancel-capture", tabId });
}

async function sendRuntimeRequest(tabId: number, message: Record<string, unknown>): Promise<void> {
  const setActionError = useSidePanelStore.getState().setActionError;
  setActionError(tabId, null);
  try {
    const response = await browser.runtime.sendMessage(message) as { ok?: boolean; error?: string } | undefined;
    if (!response?.ok) throw new Error(response?.error ?? "Chrome拡張機能の処理に失敗しました");
  } catch (error: unknown) {
    setActionError(tabId, error instanceof Error ? error.message : String(error));
  }
}

function useActiveTabState() {
  const setActiveTabId = useSidePanelStore((state) => state.setActiveTabId);
  const setTabState = useSidePanelStore((state) => state.setTabState);
  const setLastAssistantMessage = useSidePanelStore((state) => state.setLastAssistant);

  useEffect(() => {
    let disposed = false;

    const load = async (tabId?: number) => {
      const resolvedTabId = tabId ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id ?? null;
      if (disposed) return;
      setActiveTabId(resolvedTabId);
      if (resolvedTabId === null) {
        setTabState(null);
        setLastAssistantMessage(null);
        return;
      }
      const [tabState, assistant] = await Promise.all([getTabState(resolvedTabId), getLastAssistant(resolvedTabId)]);
      if (disposed) return;
      setTabState(tabState);
      setLastAssistantMessage(assistant && assistant.threadId === tabState.threadId ? assistant : null);
    };

    void load();
    const activated = ({ tabId }: { tabId: number }) => { void load(tabId); };
    const updated = (tabId: number, changeInfo: { url?: string; status?: string }) => {
      if (tabId !== useSidePanelStore.getState().activeTabId) return;
      if (changeInfo.url || changeInfo.status === "complete") void load(tabId);
    };
    const storageChanged = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
      if (area === "local" && isDeepReaderStorageChange(changes)) void load(useSidePanelStore.getState().activeTabId ?? undefined);
    };
    browser.tabs.onActivated.addListener(activated);
    browser.tabs.onUpdated.addListener(updated);
    browser.storage.onChanged.addListener(storageChanged);
    return () => {
      disposed = true;
      browser.tabs.onActivated.removeListener(activated);
      browser.tabs.onUpdated.removeListener(updated);
      browser.storage.onChanged.removeListener(storageChanged);
    };
  }, [setActiveTabId, setLastAssistantMessage, setTabState]);
}
