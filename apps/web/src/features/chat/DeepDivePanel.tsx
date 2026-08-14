import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Check, LoaderCircle, MessageSquareText, Plus, Square, X } from "lucide-react";
import type { ChatMessage, ChatTurnStreamEvent } from "@deep-reader/shared";
import {
  createBookChatThread,
  createInsightFromMessage,
  fetchBookChat,
  fetchBookChatThreads,
  fetchCodexStatus,
  fetchInsights,
  interruptChatTurn,
  streamChatTurn,
} from "../../lib/api";
import { useReaderStore } from "../../store/reader-store";
import { useSourceDraftStore } from "../../store/source-draft-store";
import { InsightLibrary } from "../insights/InsightLibrary";
import { MarkdownMessage } from "./MarkdownMessage";
import { formatSourcePage } from "./source-display";

function upsertMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return [...messages, message];
  return messages.map((candidate, candidateIndex) => candidateIndex === index ? message : candidate);
}

/** Grounded chat panel: explicit SourceAnchors in, streamed/persisted Codex answer out. */
export function DeepDivePanel() {
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeBookId = useReaderStore((state) => state.activeBookId);
  const openSource = useReaderStore((state) => state.openSource);
  const attachedSources = useSourceDraftStore((state) => state.attachedSources);
  const removeSource = useSourceDraftStore((state) => state.removeSource);
  const clearSources = useSourceDraftStore((state) => state.clearSources);
  const focusRequest = useSourceDraftStore((state) => state.composerFocusRequest);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<"chat" | "insights">("chat");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const threads = useQuery({
    queryKey: ["book-chat-threads", activeBookId],
    queryFn: ({ signal }) => fetchBookChatThreads(activeBookId!, signal),
    enabled: Boolean(activeBookId),
  });
  const chat = useQuery({
    queryKey: ["book-chat", activeBookId, activeThreadId],
    queryFn: ({ signal }) => fetchBookChat(activeBookId!, activeThreadId ?? undefined, signal),
    enabled: Boolean(activeBookId),
  });
  const codex = useQuery({
    queryKey: ["codex-status"],
    queryFn: ({ signal }) => fetchCodexStatus(signal),
    staleTime: 30_000,
  });
  const insights = useQuery({
    queryKey: ["insights", activeBookId],
    queryFn: ({ signal }) => fetchInsights(activeBookId!, signal),
    enabled: Boolean(activeBookId),
  });
  const createThread = useMutation({
    mutationFn: () => createBookChatThread(activeBookId!, {}),
    onSuccess: async (created) => {
      const id = created.thread?.id ?? null;
      setActiveThreadId(id);
      setMessages([]);
      clearSources();
      await queryClient.invalidateQueries({ queryKey: ["book-chat-threads", activeBookId] });
      if (id) queryClient.setQueryData(["book-chat", activeBookId, id], created);
    },
  });
  const saveInsight = useMutation({
    mutationFn: ({ messageId }: { messageId: string }) => createInsightFromMessage({ messageId }),
    onSuccess: async (detail) => {
      if (activeBookId) {
        await queryClient.invalidateQueries({ queryKey: ["insights", activeBookId] });
      }
      queryClient.setQueryData(["insight-detail", detail.artifact.id], detail);
    },
  });

  useEffect(() => {
    setMessages(chat.data?.thread?.messages ?? []);
  }, [activeBookId, activeThreadId, chat.data]);

  useEffect(() => {
    setPanelMode("chat");
    setActiveThreadId(null);
  }, [activeBookId]);

  useEffect(() => {
    if (!activeBookId || activeThreadId || !threads.data) return;
    setActiveThreadId(threads.data.threads[0]?.id ?? null);
  }, [activeBookId, activeThreadId, threads.data]);

  useEffect(() => {
    if (focusRequest > 0) {
      setPanelMode("chat");
      textareaRef.current?.focus();
    }
  }, [focusRequest]);

  const sourceCharacters = useMemo(
    () => attachedSources.reduce((total, source) => total + source.quoteNormalized.length, 0),
    [attachedSources],
  );
  const defaultModel = codex.data?.models.find((model) => model.isDefault)?.id;
  const canSend = Boolean(
    activeBookId
      && attachedSources.length > 0
      && question.trim()
      && !isStreaming
      && codex.data?.ready
      && codex.data.account,
  );

  const handleStreamEvent = (event: ChatTurnStreamEvent) => {
    if (event.type === "turn-started") {
      setActiveThreadId(event.threadId);
      setMessages((current) => upsertMessage(upsertMessage(current, event.userMessage), event.assistantMessage));
      clearSources();
      return;
    }
    if (event.type === "delta") {
      setMessages((current) => current.map((message) => message.id === event.messageId
        ? { ...message, content: `${message.content}${event.delta}`, status: "streaming" }
        : message));
      return;
    }
    if (event.type === "completed") {
      setMessages((current) => upsertMessage(current, event.message));
      return;
    }
    setStreamError(event.message);
    if (event.messageId) {
      setMessages((current) => current.map((message) => message.id === event.messageId
        ? { ...message, status: "error" }
        : message));
    }
  };

  const sendQuestion = async () => {
    if (!activeBookId || !canSend) return;
    const submittedQuestion = question.trim();
    const sourceIds = attachedSources.map((source) => source.id);
    setQuestion("");
    setStreamError(null);
    setIsStreaming(true);

    try {
      await streamChatTurn(
        activeBookId,
        {
          question: submittedQuestion,
          sourceIds,
          ...(defaultModel ? { model: defaultModel } : {}),
          ...(activeThreadId ? { threadId: activeThreadId } : {}),
        },
        handleStreamEvent,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["book-chat", activeBookId] }),
        queryClient.invalidateQueries({ queryKey: ["book-chat-threads", activeBookId] }),
      ]);
    } catch (error: unknown) {
      setStreamError(error instanceof Error ? error.message : "Deep Diveの送信に失敗しました");
      setQuestion((current) => current || submittedQuestion);
    } finally {
      setIsStreaming(false);
    }
  };

  const interrupt = async () => {
    if (!activeBookId || !isStreaming) return;
    try {
      await interruptChatTurn(activeBookId);
    } catch (error: unknown) {
      setStreamError(error instanceof Error ? error.message : "停止に失敗しました");
    }
  };

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold"><MessageSquareText size={16} />{panelMode === "chat" ? "Deep Dive" : "Insights"}</div>
        <button
          className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          disabled={!activeBookId}
          onClick={() => setPanelMode((mode) => mode === "chat" ? "insights" : "chat")}
        >{panelMode === "chat" ? `Insights${insights.data ? ` (${insights.data.artifacts.length})` : ""}` : "Chat"}</button>
      </div>

      {panelMode === "chat" && activeBookId ? (
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2">
          <select
            aria-label="Deep Dive Chat"
            className="min-w-0 flex-1 truncate rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none"
            value={activeThreadId ?? ""}
            disabled={isStreaming}
            onChange={(event) => setActiveThreadId(event.target.value || null)}
          >
            {(threads.data?.threads.length ?? 0) === 0 ? <option value="">最初のDeep Dive</option> : null}
            {threads.data?.threads.map((thread) => (
              <option key={thread.id} value={thread.id}>{thread.title} · {thread.messageCount}</option>
            ))}
          </select>
          <button
            className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            disabled={isStreaming || createThread.isPending}
            onClick={() => createThread.mutate()}
          ><Plus size={12} />新規</button>
        </div>
      ) : null}

      {panelMode === "insights" && activeBookId ? (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <InsightLibrary bookId={activeBookId} onStartDeepDive={() => setPanelMode("chat")} />
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {chat.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><LoaderCircle size={16} className="animate-spin" />履歴を読み込み中…</div>
            ) : messages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-500">
                本文を選択して質問すると、選択範囲だけを根拠としてDeep Diveを開始します。複数箇所を同時に参照できます。
              </div>
            ) : (
              <div className="space-y-5">
                {messages.map((message) => {
                  const originSaved = Boolean(
                    message.role === "assistant"
                      && message.codexTurnId
                      && insights.data?.artifacts.some((artifact) => artifact.originTurnIds.includes(message.codexTurnId!)),
                  );
                  const isSavingThisMessage = saveInsight.isPending && saveInsight.variables?.messageId === message.id;

                  return (
                    <article key={message.id} className={message.role === "user" ? "ml-8" : "mr-3"}>
                      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        {message.role === "user" ? "You" : "Deep Reader"}
                        {message.status === "streaming" ? <LoaderCircle size={12} className="animate-spin" /> : null}
                        {message.status === "error" ? <span className="text-red-500">error</span> : null}
                        {message.status === "interrupted" ? <span>stopped</span> : null}
                      </div>
                      <div className={message.role === "user"
                        ? "rounded-xl bg-slate-900 px-4 py-3 text-sm leading-6 text-white"
                        : "rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"}
                      >
                        {message.role === "assistant" ? (
                          message.content ? (
                            <MarkdownMessage
                              markdown={message.content}
                              sources={message.sources}
                              onOpenSource={(source) => openSource(source.sourceAnchorId, source.pageStart + 1)}
                            />
                          ) : <span className="text-sm text-slate-400">考えています…</span>
                        ) : <p className="whitespace-pre-wrap">{message.content}</p>}
                      </div>
                      {message.role === "assistant" && message.invalidCitationLabels.length > 0 ? (
                        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
                          未知の引用IDを検出: {message.invalidCitationLabels.join(", ")}。この回答は参照関係の確認が必要です。
                        </div>
                      ) : null}
                      {message.role === "assistant" && message.sources.some((source) => source.origin === "ai-expansion") ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span className="mr-1 self-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">AI追加参照</span>
                          {message.sources.filter((source) => source.origin === "ai-expansion").map((source) => (
                            <button
                              key={`${message.id}-expanded-${source.label}`}
                              className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 hover:bg-violet-100"
                              onClick={() => openSource(source.sourceAnchorId, source.pageStart + 1)}
                            >{source.label} · {formatSourcePage(source)}</button>
                          ))}
                        </div>
                      ) : null}
                      {message.role === "assistant" && message.retrievalEvents.length > 0 ? (
                        <details className="mt-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-600">
                          <summary className="cursor-pointer select-none font-medium text-slate-500">AI参照履歴 · {message.retrievalEvents.length}</summary>
                          <div className="mt-2 space-y-2">
                            {message.retrievalEvents.map((event, index) => (
                              <div key={event.id} className="rounded-md border border-slate-200 bg-white p-2">
                                <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
                                  <span className="font-semibold text-slate-600">{formatRetrievalToolName(event.toolName)}</span>
                                  <span className="text-slate-400">{index + 1}</span>
                                </div>
                                <div className="space-y-1 text-[10px] leading-4 text-slate-500">
                                  <div><span className="font-medium">request</span><pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-1.5">{formatAuditJson(event.arguments)}</pre></div>
                                  <div><span className="font-medium">result</span><pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-1.5">{formatAuditJson(event.resultSummary)}</pre></div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}
                      {message.role === "assistant" && message.status === "completed" ? (
                        <div className="mt-2 flex justify-end">
                          <button
                            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-default disabled:opacity-60"
                            disabled={originSaved || isSavingThisMessage}
                            onClick={() => saveInsight.mutate({ messageId: message.id })}
                          >
                            {originSaved ? <><Check size={12} />Insight保存済み</> : isSavingThisMessage ? <><LoaderCircle size={12} className="animate-spin" />保存中</> : <><BookmarkPlus size={12} />Insightに保存</>}
                          </button>
                        </div>
                      ) : null}
                      {message.role === "user" && message.sources.length > 0 ? (
                        <div className="mt-2 space-y-2">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {message.sources.map((source) => (
                              <button
                                key={`${message.id}-${source.label}`}
                                className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-50"
                                onClick={() => openSource(source.sourceAnchorId, source.pageStart + 1)}
                              >{source.label} · {formatSourcePage(source)}</button>
                            ))}
                          </div>
                          <details className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-600">
                            <summary className="cursor-pointer select-none font-medium text-slate-500">送信Contextを確認</summary>
                            <div className="mt-2 space-y-2">
                              {message.sources.map((source) => (
                                <div key={`${message.id}-audit-${source.label}`} className="rounded-md border border-slate-200 bg-white p-2">
                                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-slate-500">
                                    <span>{source.label}</span>
                                    <span>{formatSourcePage(source)}</span>
                                    <span>{source.origin === "user-selection" ? "ユーザー選択" : "AI追加参照"}</span>
                                    {source.truncated ? <span className="text-amber-700">Context Budgetで省略</span> : null}
                                  </div>
                                  <p className="whitespace-pre-wrap break-words leading-5 text-slate-600">{source.includedText}</p>
                                </div>
                              ))}
                            </div>
                          </details>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          {attachedSources.length > 0 ? (
            <div className="max-h-48 overflow-auto border-t border-slate-200 bg-slate-50/70 px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Context · {attachedSources.length} sources</span>
                <span className="text-[11px] tabular-nums text-slate-400">{sourceCharacters.toLocaleString()} chars</span>
              </div>
              <div className="space-y-2">
                {attachedSources.map((source, index) => (
                  <div key={source.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        className="text-xs font-semibold text-blue-700 hover:underline"
                        onClick={() => openSource(source.id, source.pageStart + 1)}
                      >S{index + 1} · {formatSourcePage(source)}</button>
                      <button
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        onClick={() => removeSource(source.id)}
                        aria-label="引用を外す"
                      ><X size={13} /></button>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{source.quoteRaw}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="border-t border-slate-200 p-4">
            {streamError ? <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{streamError}</p> : null}
            {saveInsight.isError ? <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{saveInsight.error.message}</p> : null}
            <div className="rounded-xl border border-slate-300 bg-white p-3 shadow-sm focus-within:border-slate-400">
              <textarea
                ref={textareaRef}
                aria-label="質問"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void sendQuestion();
                  }
                }}
                className="min-h-20 w-full resize-none bg-transparent text-sm outline-none placeholder:text-slate-400"
                placeholder={attachedSources.length > 0 ? `${attachedSources.length}件の引用について質問…` : "本文を選択して質問…"}
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="truncate text-[11px] text-slate-400">
                  {codex.data?.account ? `${defaultModel ?? "Codex"} · read-only` : "ChatGPTログインが必要です"}
                </span>
                {isStreaming ? (
                  <button
                    onClick={() => void interrupt()}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  ><Square size={13} />停止</button>
                ) : (
                  <button
                    disabled={!canSend}
                    onClick={() => void sendQuestion()}
                    className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >送信</button>
                )}
              </div>
            </div>
            <div className="mt-1.5 text-right text-[10px] text-slate-400">⌘/Ctrl + Enter で送信</div>
          </div>
        </>
      )}
    </aside>
  );
}


function formatRetrievalToolName(toolName: string): string {
  switch (toolName) {
    case "book_expand_source": return "前後文脈を追加読取";
    case "book_search": return "書籍内検索";
    case "book_read_blocks": return "検索候補を本文読取";
    case "book_list_sections": return "章・節を確認";
    case "book_read_section": return "章・節を本文読取";
    default: return toolName;
  }
}

function formatAuditJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
