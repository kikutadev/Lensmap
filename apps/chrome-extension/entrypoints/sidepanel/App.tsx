import type { ExploreMessage, ExploreMessageSource, MapArtifactSummary, ReaderWorkspace } from "@lensmap/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpenText,
  Check,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  FileText,
  LibraryBig,
  LoaderCircle,
  ScanLine,
  Plus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { browser } from "wxt/browser";
import {
  createWorkspace,
  createWorkspaceExploreThread,
  fetchCodexStatus,
  fetchCodexUsage,
  fetchMaps,
  fetchVisualSourceAsset,
  fetchWorkspace,
  fetchWorkspaceExplore,
  fetchWorkspaceExploreThreads,
  fetchWorkspaces,
  removeWorkspaceSource,
  streamExploreTurn,
} from "../../lib/api";
import {
  getActiveWorkspaceId,
  getTabState,
  isLensmapStorageChange,
  setActiveWorkspaceId as persistActiveWorkspaceId,
  type LensmapTabState,
} from "../../lib/state";
import { requestServerStartup } from "../../lib/request-server-startup";
import { ensureVisualCaptureHostPermission } from "../../lib/visual-capture-permission";
import { MapDetail } from "./MapDetail";
import { RichMessage } from "./rich/RichMessage";
import { SourceReference } from "./rich/SourceReference";
import { useSidePanelStore } from "./store";

export function App() {
  useBrowserContext();
  const queryClient = useQueryClient();
  const view = useSidePanelStore((state) => state.view);
  const setView = useSidePanelStore((state) => state.setView);
  const tabState = useSidePanelStore((state) => state.tabState);
  const activeWorkspaceId = useSidePanelStore((state) => state.activeWorkspaceId);
  const setActiveWorkspaceId = useSidePanelStore((state) => state.setActiveWorkspaceId);
  const transient = useSidePanelStore((state) => activeWorkspaceId ? state.transientByWorkspace[activeWorkspaceId] : undefined);
  const setModelOverride = useSidePanelStore((state) => state.setModelOverride);
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: ({ signal }) => fetchWorkspaces(signal),
  });
  const workspace = useQuery({
    queryKey: ["workspace", activeWorkspaceId],
    queryFn: ({ signal }) => fetchWorkspace(activeWorkspaceId!, signal),
    enabled: Boolean(activeWorkspaceId),
  });
  const headerExplore = useQuery({
    queryKey: ["workspace-explore", activeWorkspaceId, transient?.activeThreadId ?? null],
    queryFn: ({ signal }) => fetchWorkspaceExplore(activeWorkspaceId!, transient?.activeThreadId ?? undefined, signal),
    enabled: Boolean(activeWorkspaceId),
  });
  const codex = useQuery({
    queryKey: ["codex-status"],
    queryFn: async ({ signal }) => {
      await requestServerStartup(signal);
      return fetchCodexStatus(signal);
    },
    refetchInterval: 60_000,
  });
  const codexUsage = useQuery({
    queryKey: ["codex-usage", headerExplore.data?.thread?.codexThreadId ?? null],
    queryFn: ({ signal }) => fetchCodexUsage(headerExplore.data?.thread?.codexThreadId ?? null, signal),
    enabled: codex.data?.ready === true,
    refetchInterval: 30_000,
  });
  const selectedModel = transient?.modelOverride
    ?? headerExplore.data?.thread?.model
    ?? codex.data?.models.find((model) => model.isDefault)?.id
    ?? codex.data?.models[0]?.id
    ?? null;
  const connectionMessage = codex.isError
    ? codex.error instanceof Error ? codex.error.message : "Lensmap Serverに接続できません。"
    : codex.data && !codex.data.ready ? codex.data.error ?? "Codex App Serverに接続できません。" : null;

  useEffect(() => {
    let disposed = false;
    void browser.storage.local.get("lensmap.onboardingDismissed").then((stored) => {
      if (!disposed) setShowOnboarding(stored["lensmap.onboardingDismissed"] !== true);
    });
    return () => { disposed = true; };
  }, []);

  const dismissOnboarding = async () => {
    await browser.storage.local.set({ "lensmap.onboardingDismissed": true });
    setShowOnboarding(false);
  };

  const switchWorkspace = async (workspaceId: string) => {
    if (!workspaceId) return;
    await persistActiveWorkspaceId(workspaceId);
    setActiveWorkspaceId(workspaceId);
    setView("explore");
  };
  const newWorkspace = async () => {
    const created = await createWorkspace({
      ...(tabState?.bookId ? { bookId: tabState.bookId } : {}),
      name: tabState?.bookId ? undefined : "新しいWorkspace",
    });
    await persistActiveWorkspaceId(created.id);
    setActiveWorkspaceId(created.id);
    await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand"><strong>Lensmap</strong></div>
        <div className="header-actions">
          <CodexControl
            status={codex.data?.ready ? "ready" : codex.isLoading ? "loading" : "offline"}
            models={codex.data?.models ?? []}
            selectedModel={selectedModel}
            usage={codexUsage.data ?? null}
            onSelectModel={(model) => { if (activeWorkspaceId) setModelOverride(activeWorkspaceId, model); }}
          />
          <button className="header-help" type="button" aria-label="Lensmapヘルプ" title="ヘルプ" onClick={() => { void openHelpPage(); }}><CircleHelp size={17} /></button>
        </div>
      </header>

      <section className="workspace-bar" aria-label="Reader Workspace">
        <select value={activeWorkspaceId ?? ""} onChange={(event) => { void switchWorkspace(event.target.value); }} aria-label="Workspace">
          {!activeWorkspaceId ? <option value="">Workspaceを選択</option> : null}
          {workspaces.data?.workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button className="icon-button" title="新しいWorkspace" aria-label="新しいWorkspace" onClick={() => { void newWorkspace(); }}><Plus size={15} /></button>
        {workspace.data ? <span className="workspace-summary">{workspace.data.books.length} documents · {workspace.data.sources.length} references</span> : null}
      </section>

      <nav className="view-tabs" aria-label="Lensmap views">
        <button className={view === "explore" ? "active" : ""} onClick={() => setView("explore")}>Explore</button>
        <button className={view === "maps" ? "active" : ""} onClick={() => setView("maps")} disabled={!activeWorkspaceId}>Maps</button>
      </nav>

      <main className="app-main">
        {connectionMessage ? <ConnectionNotice message={connectionMessage} retrying={codex.isFetching} onRetry={() => { void codex.refetch(); }} /> : null}
        {showOnboarding ? <OnboardingCard onDismiss={() => { void dismissOnboarding(); }} onOpenHelp={() => { void openHelpPage(); }} /> : null}
        {!activeWorkspaceId ? <EmptyState /> : null}
        {activeWorkspaceId && workspace.data ? (
          view === "explore"
            ? <ExploreView workspace={workspace.data} tabState={tabState} />
            : <MapsView workspace={workspace.data} />
        ) : null}
      </main>
    </div>
  );
}

function ExploreView({ workspace, tabState }: { workspace: ReaderWorkspace; tabState: LensmapTabState | null }) {
  const queryClient = useQueryClient();
  const workspaceId = workspace.id;
  const transient = useSidePanelStore((state) => state.transientByWorkspace[workspaceId]);
  const streamingContent = transient?.streamingContent ?? "";
  const streamStatus = transient?.streamStatus ?? "idle";
  const question = transient?.composerDraft ?? "";
  const actionError = transient?.actionError ?? null;
  const modelOverride = transient?.modelOverride ?? null;
  const activeThreadId = transient?.activeThreadId ?? null;
  const setStreamState = useSidePanelStore((state) => state.setStreamState);
  const appendStreamingContent = useSidePanelStore((state) => state.appendStreamingContent);
  const setComposerDraft = useSidePanelStore((state) => state.setComposerDraft);
  const setActionError = useSidePanelStore((state) => state.setActionError);
  const setModelOverride = useSidePanelStore((state) => state.setModelOverride);
  const setActiveThreadId = useSidePanelStore((state) => state.setActiveThreadId);
  const streaming = streamStatus === "streaming";
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusRequest = useRef(tabState?.composerFocusRequest ?? 0);

  const explore = useQuery({
    queryKey: ["workspace-explore", workspaceId, activeThreadId],
    queryFn: ({ signal }) => fetchWorkspaceExplore(workspaceId, activeThreadId ?? undefined, signal),
  });
  const threads = useQuery({
    queryKey: ["workspace-explore-threads", workspaceId],
    queryFn: ({ signal }) => fetchWorkspaceExploreThreads(workspaceId, signal),
  });
  const createThread = useMutation({
    mutationFn: () => createWorkspaceExploreThread(workspaceId, modelOverride ? { model: modelOverride } : {}),
    onSuccess: async (result) => {
      setActiveThreadId(workspaceId, result.thread?.id ?? null);
      setActionError(workspaceId, null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace-explore-threads", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-explore", workspaceId] }),
      ]);
    },
    onError: (error) => setActionError(workspaceId, error instanceof Error ? error.message : String(error)),
  });

  useEffect(() => {
    if (!tabState || tabState.workspaceId !== workspaceId || tabState.composerFocusRequest === lastFocusRequest.current) return;
    lastFocusRequest.current = tabState.composerFocusRequest;
    questionRef.current?.focus();
  }, [tabState, workspaceId]);

  const messages = explore.data?.thread?.messages ?? [];
  const displayedMessages = useMemo(() => {
    if (!streamingContent) return messages;
    const assistant: ExploreMessage = {
      id: `transient:${workspaceId}`,
      threadId: activeThreadId ?? explore.data?.thread?.id ?? "streaming",
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
    return [...messages, assistant];
  }, [activeThreadId, explore.data?.thread?.id, messages, streamStatus, streamingContent, workspaceId]);

  const send = async () => {
    const trimmed = question.trim();
    if (!trimmed || workspace.sources.length === 0 || streaming) return;
    setActionError(workspaceId, null);
    setStreamState(workspaceId, "streaming", "");
    try {
      await streamExploreTurn({
        workspaceId,
        question: trimmed,
        sourceIds: workspace.sources.map((source) => source.id),
        threadId: activeThreadId ?? explore.data?.thread?.id ?? null,
        model: modelOverride ?? explore.data?.thread?.model ?? null,
      }, (event) => {
        if (event.type === "turn-started") {
          setActiveThreadId(workspaceId, event.threadId);
          setStreamState(workspaceId, "streaming", "");
        } else if (event.type === "delta") {
          appendStreamingContent(workspaceId, event.delta);
        } else if (event.type === "completed") {
          setStreamState(workspaceId, "idle", "");
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      });
      setComposerDraft(workspaceId, "");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace-explore", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-explore-threads", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["maps", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["codex-usage"] }),
      ]);
    } catch (error: unknown) {
      setStreamState(workspaceId, "error", `エラー: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const switchThread = (threadId: string | null) => {
    setActiveThreadId(workspaceId, threadId);
    setStreamState(workspaceId, "idle", "");
    setActionError(workspaceId, null);
    setModelOverride(workspaceId, null);
  };

  return (
    <div className="explore-view">
      <div className="thread-toolbar">
        <select aria-label="Explore thread" value={activeThreadId ?? explore.data?.thread?.id ?? ""} onChange={(event) => switchThread(event.target.value || null)}>
          {!threads.data?.threads.length ? <option value="">最初のExplore</option> : null}
          {threads.data?.threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title}</option>)}
        </select>
        <button className="secondary-button" disabled={createThread.isPending || workspace.books.length === 0} onClick={() => createThread.mutate()} aria-label="新しいExplore">
          {createThread.isPending ? <LoaderCircle className="spin" size={13} /> : <Plus size={13} />}新規
        </button>
      </div>

      {tabState && tabState.status !== "idle" ? <CaptureStatus state={tabState} /> : null}
      {actionError ? <ActionError workspaceId={workspaceId} message={actionError} /> : null}
      <ReferenceShelf workspace={workspace} tabState={tabState} />
      {tabState?.status === "ambiguous" && tabState.workspaceId === workspaceId ? <AmbiguousCandidates state={tabState} /> : null}

      <section className="messages" aria-live="polite">
        {displayedMessages.length === 0
          ? <div className="message-placeholder">参照を追加して質問すると、必要な箇所だけWorkspace内から追加探索しながら回答します。</div>
          : displayedMessages.map((message) => <MessageCard key={message.id} message={message} />)}
      </section>

      <section className="composer">
        <textarea
          ref={questionRef}
          value={question}
          onChange={(event) => setComposerDraft(workspaceId, event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="この一節について聞く…"
          aria-label="質問"
          disabled={streaming || workspace.sources.length === 0}
        />
        <div className="composer-footer">
          <span>⌘/Ctrl + Enter</span>
          <button disabled={streaming || !question.trim() || workspace.sources.length === 0} onClick={() => { void send(); }}>
            {streaming ? <LoaderCircle className="spin" size={14} /> : <ChevronRight size={14} />}送信
          </button>
        </div>
      </section>
    </div>
  );
}

function ReferenceShelf({ workspace, tabState }: { workspace: ReaderWorkspace; tabState: LensmapTabState | null }) {
  const queryClient = useQueryClient();
  const bookTitles = new Map(workspace.books.map((book) => [book.id, book.title]));
  const canCaptureVisual = Boolean(tabState?.bookId && tabState.pdfUrl);
  const remove = async (sourceId: string) => {
    await removeWorkspaceSource(workspace.id, sourceId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workspace", workspace.id] }),
      queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
    ]);
  };
  const beginVisual = async () => {
    if (!tabState?.pdfUrl) return;
    await ensureVisualCaptureHostPermission();
    await sendRuntimeRequest({ type: "begin-visual-capture", tabId: tabState.tabId, workspaceId: workspace.id });
  };
  return (
    <section className="source-section reference-shelf">
      <div className="section-heading reference-heading">
        <div><FileText size={14} /><strong>参照</strong><span>{workspace.sources.length}</span></div>
        <button className="text-button visual-capture-button" disabled={!canCaptureVisual} title={canCaptureVisual ? "表示中のPDFから画像領域を選択" : "Lensmapで認識済みのPDFタブを表示してください"} onClick={() => { void beginVisual(); }}><ScanLine size={13} />範囲を選択</button>
      </div>
      {workspace.sources.length === 0 ? <div className="message-placeholder compact">テキスト選択または「範囲を選択」で参照を追加します。</div> : (
        <details open={workspace.sources.length <= 3}>
          <summary className="reference-summary">{workspace.sources.length <= 3 ? "参照一覧" : `${workspace.sources.length}件の参照を表示`}</summary>
          <div className="source-list">
            {workspace.sources.map((source, index) => (
              <article className={`source-card ${source.kind}`} key={source.id}>
                <button className="source-main" onClick={() => { if (source.kind === "text") void requestCitation(source.bookId, source.pageStart + 1); else if (source.page !== undefined) void requestCitation(source.bookId, source.page + 1); }}>
                  <span className="source-label">S{index + 1} · {bookTitles.get(source.bookId) ?? "PDF"} · {source.kind === "text" ? `p.${source.pageStart + 1}` : source.page === undefined ? "Visual · page unresolved" : `Visual · p.${source.page + 1}`}</span>
                  <span className="source-quote">{source.kind === "text" ? source.quoteRaw : source.recognizedText?.trim() || "画像領域を一次根拠として保存済み"}</span>
                </button>
                <button className="icon-button" aria-label="参照を外す" onClick={() => { void remove(source.id); }}><X size={14} /></button>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function MessageCard({ message }: { message: ExploreMessage }) {
  const usedSources = message.role === "assistant" ? message.sources.filter((source) => message.content.includes(`[${source.label}]`)) : message.sources;
  const stateLabel = message.status === "streaming" ? " · 生成中" : message.status === "error" ? " · エラー" : "";
  return (
    <article className={`message ${message.role} ${message.status === "error" ? "error" : ""}`}>
      <div className="message-meta">{message.role === "user" ? "You" : "Lensmap"}{stateLabel}</div>
      <div className="message-content">{message.role === "assistant"
        ? <RichMessage markdown={message.content} sources={message.sources} onOpenSource={(source) => { void requestMessageSource(source); }} />
        : message.content}</div>
      {usedSources.length > 0 ? <div className="citation-row">{usedSources.map((source) => (
        <SourceReference key={`${message.id}-${source.label}`} source={source} variant="chip" onOpen={(selected) => { void requestMessageSource(selected); }} />
      ))}</div> : null}
      {message.retrievalEvents.length > 0 ? <RetrievalSummary message={message} /> : null}
      {message.role === "assistant" && message.status === "completed" ? <div className="map-save-state"><Check size={12} />Mapに保存済み</div> : null}
    </article>
  );
}

function RetrievalSummary({ message }: { message: ExploreMessage }) {
  const readEvents = message.retrievalEvents.filter((event) => /read|expand/u.test(event.toolName));
  return (
    <details className="retrieval-audit">
      <summary>{Math.max(1, readEvents.length)}箇所を追加参照</summary>
      {message.retrievalEvents.map((event) => (
        <div key={event.id}>
          <strong>{humanToolName(event.toolName)}</strong>
          <span>{humanRetrievalSummary(event.resultSummary)}</span>
        </div>
      ))}
    </details>
  );
}

function humanToolName(toolName: string): string {
  if (toolName === "workspace_search") return "Workspaceを検索";
  if (toolName === "workspace_expand_source") return "前後の文脈";
  if (toolName === "workspace_list_sections") return "節を確認";
  if (toolName === "workspace_read_section") return "節を追加参照";
  if (toolName === "workspace_read_blocks") return "検索結果を追加参照";
  return "追加参照";
}

function humanRetrievalSummary(value: unknown): string {
  if (!value || typeof value !== "object") return "関連箇所を確認しました";
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.sourceLabels) && record.sourceLabels.length) return `${record.sourceLabels.join(", ")} を回答根拠に追加`;
  if (typeof record.candidateCount === "number") return `${record.candidateCount}件の候補を確認`;
  if (typeof record.sectionCount === "number") return `${record.sectionCount}節を確認`;
  return "関連箇所を確認しました";
}

function MapsView({ workspace }: { workspace: ReaderWorkspace }) {
  const workspaceId = workspace.id;
  const selectedMapId = useSidePanelStore((state) => state.transientByWorkspace[workspaceId]?.selectedMapId ?? null);
  const setSelectedMapId = useSidePanelStore((state) => state.setSelectedMapId);
  const maps = useQuery({
    queryKey: ["maps", workspaceId],
    queryFn: ({ signal }) => fetchMaps(workspaceId, signal),
  });
  if (selectedMapId) {
    return <MapDetail
      mapArtifactId={selectedMapId}
      onBack={() => setSelectedMapId(workspaceId, null)}
      onOpenSource={(bookId, page) => { void requestCitation(bookId, page); }}
    />;
  }
  return (
    <div className="map-list-view">
      <div className="section-heading"><div><LibraryBig size={14} /><strong>Maps</strong><span>{maps.data?.artifacts.length ?? 0}</span></div></div>
      {maps.isLoading ? <LoaderBlock label="Mapsを読み込み中…" /> : null}
      {maps.data?.artifacts.length === 0 ? <div className="message-placeholder">Exploreの回答は完了時に自動でMapsへ蓄積されます。</div> : null}
      <div className="map-list map-grid">
        {maps.data?.artifacts.map((artifact) => <MapListItem key={artifact.id} artifact={artifact} onOpen={() => setSelectedMapId(workspaceId, artifact.id)} />)}
      </div>
    </div>
  );
}

function MapListItem({ artifact, onOpen }: { artifact: MapArtifactSummary; onOpen: () => void }) {
  const provenance = artifact.sourceBooks.map((book) => `${book.title}${book.pages.length ? ` p.${book.pages.slice(0, 2).join(",")}` : ""}`).join(" · ");
  return (
    <button className="map-list-item map-card" onClick={onOpen}>
      <MapCardVisual artifact={artifact} />
      <div className="map-list-copy">
        <strong>{artifact.title}</strong>
        {artifact.preview ? <p>{artifact.preview}</p> : null}
        <span>{provenance || `${artifact.sourceCount} references`}</span>
      </div>
      <ChevronRight size={16} />
    </button>
  );
}

function MapCardVisual({ artifact }: { artifact: MapArtifactSummary }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!artifact.primaryVisualSource) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void fetchVisualSourceAsset(artifact.primaryVisualSource.bookId, artifact.primaryVisualSource.imageAssetId, controller.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact.primaryVisualSource]);
  if (url) return <div className="map-thumbnail image"><img src={url} alt="" /></div>;

  const content = artifact.primaryBlock ? mapRecord(artifact.primaryBlock.content) : null;
  const visualization = content?.format === "visualization" ? mapRecord(content.visualization) : null;
  if (visualization?.type === "definition") {
    return <div className="map-thumbnail semantic definition"><strong>{typeof visualization.term === "string" ? visualization.term : "Definition"}</strong><span>{typeof visualization.definition === "string" ? visualization.definition : ""}</span></div>;
  }
  if (visualization?.type === "table") {
    const columns = Array.isArray(visualization.columns) ? visualization.columns.filter((value): value is string => typeof value === "string") : [];
    const rows = Array.isArray(visualization.rows) ? visualization.rows.slice(0, 2) : [];
    return <div className="map-thumbnail semantic table-preview"><div>{columns.slice(0, 3).map((column) => <strong key={column}>{column}</strong>)}</div>{rows.map((row, index) => <div key={index}>{Array.isArray(row) ? row.slice(0, 3).map((cell, cellIndex) => <span key={cellIndex}>{typeof cell === "string" ? cell : ""}</span>) : null}</div>)}</div>;
  }
  if (visualization?.type === "flow") {
    const nodes = Array.isArray(visualization.nodes) ? visualization.nodes.slice(0, 4) : [];
    return <div className="map-thumbnail semantic flow-preview">{nodes.flatMap((node, index) => { const record = mapRecord(node); const label = typeof record?.label === "string" ? record.label : ""; return [<span key={`n-${index}`}>{label}</span>, ...(index < nodes.length - 1 ? [<i key={`a-${index}`}>→</i>] : [])]; })}</div>;
  }
  if (visualization?.type === "hierarchy") {
    const nodes = Array.isArray(visualization.nodes) ? visualization.nodes.slice(0, 4) : [];
    return <div className="map-thumbnail semantic hierarchy-preview">{nodes.map((node, index) => { const record = mapRecord(node); return <span key={index} style={{ marginLeft: `${Math.min(index, 2) * 6}px` }}>{typeof record?.label === "string" ? record.label : ""}</span>; })}</div>;
  }
  if (visualization?.type === "timeline") {
    const items = Array.isArray(visualization.items) ? visualization.items.slice(0, 3) : [];
    return <div className="map-thumbnail semantic timeline-preview">{items.map((item, index) => { const record = mapRecord(item); return <span key={index}>{typeof record?.time === "string" ? `${record.time} ` : ""}{typeof record?.label === "string" ? record.label : ""}</span>; })}</div>;
  }
  if (visualization?.type === "chart") return <div className="map-thumbnail semantic chart-preview"><span>▁▂▄▆▅▇</span><strong>{typeof visualization.title === "string" ? visualization.title : "Chart"}</strong></div>;
  if (typeof content?.markdown === "string") return <div className="map-thumbnail semantic narrative"><span>{content.markdown}</span></div>;
  return <div className={`map-thumbnail ${artifact.semanticKind}`} aria-hidden="true"><LibraryBig size={20} /><span>{artifact.semanticKind}</span></div>;
}

function mapRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function CaptureStatus({ state }: { state: LensmapTabState }) {
  if (state.status === "ready" || state.status === "idle") return null;
  const labels: Record<LensmapTabState["status"], string> = {
    idle: "待機中", importing: "PDFを準備中…", resolving: "選択箇所を確認中…",
    ambiguous: "同じ選択文が複数箇所にあります", ready: "準備完了", error: state.error ?? "エラー",
  };
  const cancellable = state.status === "importing" || state.status === "resolving";
  return (
    <div className={`capture-status ${state.status === "error" ? "error" : ""}`}>
      {state.status === "error" ? <CircleAlert size={15} /> : <LoaderCircle className={state.status === "ambiguous" ? "" : "spin"} size={15} />}
      <span>{labels[state.status]}</span>
      {cancellable ? <button className="text-button" onClick={() => { void cancelCapture(state.tabId); }}>キャンセル</button> : null}
    </div>
  );
}

function AmbiguousCandidates({ state }: { state: LensmapTabState }) {
  return (
    <section className="candidate-section">
      <div className="section-heading"><div><CircleAlert size={14} /><strong>参照箇所を選択</strong></div></div>
      <p>同じ文章が複数箇所にあります。読んでいた位置を選んでください。</p>
      <div className="candidate-list">{state.resolutionCandidates.map((candidate, index) => (
        <button key={`${candidate.pageStart}-${candidate.pageEnd}-${index}`} onClick={() => { void resolveCandidate(state.tabId, index); }}>
          <strong>PDF p.{candidate.pageStart + 1}{candidate.pageEnd > candidate.pageStart ? `–${candidate.pageEnd + 1}` : ""}</strong>
          <span>{candidate.prefix ? `…${candidate.prefix.slice(-64)}` : ""}<mark>{candidate.quoteRaw.slice(0, 120)}</mark>{candidate.suffix ? `${candidate.suffix.slice(0, 64)}…` : ""}</span>
        </button>
      ))}</div>
    </section>
  );
}

function ActionError({ workspaceId, message }: { workspaceId: string; message: string }) {
  const setActionError = useSidePanelStore((state) => state.setActionError);
  return <div className="action-error" role="alert"><CircleAlert size={14} /><span>{message}</span><button className="icon-button" aria-label="エラーを閉じる" onClick={() => setActionError(workspaceId, null)}><X size={13} /></button></div>;
}

function OnboardingCard({ onDismiss, onOpenHelp }: { onDismiss: () => void; onOpenHelp: () => void }) {
  return (
    <section className="onboarding-card" aria-label="Lensmapのはじめ方">
      <div className="onboarding-heading">
        <div><strong>Lensmapのはじめ方</strong><span>Focus → Explore → Map → Return</span></div>
        <button className="icon-button" type="button" aria-label="はじめ方を閉じる" onClick={onDismiss}><X size={14} /></button>
      </div>
      <ol className="onboarding-steps">
        <li><strong>1. Focus</strong><span>PDFの一節を選ぶか、「範囲を選択」で図・表を追加します。</span></li>
        <li><strong>2. Explore</strong><span>同じWorkspaceに複数PDFの参照を集め、そのまま質問します。</span></li>
        <li><strong>3. Map</strong><span>完了した回答は自動でMapsへ整理されます。</span></li>
        <li><strong>4. Return</strong><span>Evidenceを押せば根拠のPDFへ戻れます。</span></li>
      </ol>
      <div className="onboarding-actions">
        <button className="secondary-button" type="button" onClick={onOpenHelp}>詳しい使い方</button>
        <button className="primary-button" type="button" onClick={onDismiss}>使い始める</button>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="empty-state">
      <BookOpenText size={30} />
      <h1>気になった一節から、理解の地図をつくる。</h1>
      <p>PDFで気になる一節を選び、右クリックしてLensmapへ追加します。</p>
      <div className="instruction-card"><strong>Lensmapで掘り下げる</strong><span>一節を参照に追加し、そのままExploreを始めます。</span></div>
      <div className="instruction-card"><strong>Lensmapの参照に追加</strong><span>別のPDFへ移動しても、同じWorkspaceへ参照を集められます。</span></div>
    </section>
  );
}

function CodexControl({ status, models, selectedModel, usage, onSelectModel }: {
  status: "ready" | "loading" | "offline";
  models: Array<{ id: string; displayName: string; description: string; isDefault: boolean }>;
  selectedModel: string | null;
  usage: Awaited<ReturnType<typeof fetchCodexUsage>> | null;
  onSelectModel: (model: string) => void;
}) {
  if (status === "loading") return <span className="codex-badge"><LoaderCircle className="spin" size={12} />確認中</span>;
  if (status === "offline") return <span className="codex-badge offline"><CircleAlert size={12} />未接続</span>;
  const selected = models.find((model) => model.id === selectedModel);
  const displayName = selected?.displayName ?? selectedModel ?? "Codex";
  const threadUsage = usage?.thread;
  const contextWindow = threadUsage?.modelContextWindow ?? usage?.contextWindowFallback ?? null;
  const contextTokens = threadUsage?.last.totalTokens ?? null;
  const contextPercent = contextWindow && contextTokens !== null ? Math.min(100, Math.max(0, (contextTokens / contextWindow) * 100)) : null;
  const overall = usage?.rateLimits?.secondary ?? usage?.rateLimits?.primary ?? null;
  return (
    <details className="codex-control">
      <summary aria-label={`Codex設定。モデル ${displayName}`}>
        <ContextGauge percent={contextPercent} />
        <span className="codex-control-copy"><strong>{displayName}</strong><small>{overall ? `利用 ${overall.usedPercent}%` : "Codex"}</small></span>
      </summary>
      <div className="codex-popover">
        <section className="codex-usage-section">
          <div className="codex-popover-heading"><strong>Codex</strong><span><Check size={11} />接続済み</span></div>
          <UsageLine label="Context" percent={contextPercent} detail={contextTokens !== null && contextWindow ? `${formatTokens(contextTokens)} / ${formatTokens(contextWindow)}` : "回答後に表示"} />
          {usage?.rateLimits?.primary ? <UsageLine label="利用枠" percent={usage.rateLimits.primary.usedPercent} detail={formatReset(usage.rateLimits.primary.resetsAt)} /> : null}
          {usage?.rateLimits?.secondary ? <UsageLine label="長期利用枠" percent={usage.rateLimits.secondary.usedPercent} detail={formatReset(usage.rateLimits.secondary.resetsAt)} /> : null}
        </section>
        <section className="model-picker" aria-label="Codex model"><strong>モデル</strong>{models.map((model) => (
          <button key={model.id} type="button" className={model.id === selectedModel ? "active" : ""} onClick={() => onSelectModel(model.id)}>
            <span><strong>{model.displayName}</strong><small>{model.description}</small></span>{model.id === selectedModel ? <Check size={13} /> : null}
          </button>
        ))}</section>
      </div>
    </details>
  );
}

function ContextGauge({ percent }: { percent: number | null }) {
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const dash = percent === null ? 0 : circumference * Math.min(1, Math.max(0, percent / 100));
  return <span className={`context-gauge ${percent === null ? "empty" : ""}`} title={percent === null ? "Context: 回答後に表示" : `Context ${Math.round(percent)}%`}><svg viewBox="0 0 26 26" aria-hidden="true"><circle className="context-gauge-track" cx="13" cy="13" r={radius} /><circle className="context-gauge-value" cx="13" cy="13" r={radius} strokeDasharray={`${dash} ${circumference - dash}`} /></svg><span>{percent === null ? "–" : Math.round(percent)}</span></span>;
}

function UsageLine({ label, percent, detail }: { label: string; percent: number | null; detail: string }) {
  return <div className="usage-line"><div><strong>{label}</strong><span>{percent === null ? "–" : `${Math.round(percent)}%`}</span></div><div className="usage-bar"><span style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }} /></div><small>{detail}</small></div>;
}

function ConnectionNotice({ message, retrying, onRetry }: { message: string; retrying: boolean; onRetry: () => void }) {
  return <div className="connection-notice" role="status"><CircleAlert size={15} /><div><strong>Lensmapに接続できません</strong><span>{message}</span><small>通常は自動起動します。初回セットアップ後も失敗する場合はNative Hostの登録状態を確認してください。</small><button className="secondary-button" disabled={retrying} onClick={onRetry}>{retrying ? <LoaderCircle className="spin" size={13} /> : null}再接続</button></div></div>;
}

function LoaderBlock({ label }: { label: string }) { return <div className="loader-block"><LoaderCircle className="spin" size={15} />{label}</div>; }
function formatTokens(value: number): string { return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}k` : String(value); }
function formatReset(resetsAt: number | null): string { return resetsAt ? `リセット ${new Date(resetsAt * 1000).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "リセット時刻不明"; }
async function openHelpPage(): Promise<void> { await browser.tabs.create({ url: browser.runtime.getURL("/help.html") }); }
async function requestCitation(bookId: string, page: number): Promise<void> { await sendRuntimeRequest({ type: "open-citation", bookId, page }); }
async function requestMessageSource(source: ExploreMessageSource): Promise<void> {
  if (source.kind === "text") return requestCitation(source.bookId, source.pageStart + 1);
  if (source.page !== null) return requestCitation(source.bookId, source.page + 1);
}
async function resolveCandidate(tabId: number, candidateIndex: number): Promise<void> { await sendRuntimeRequest({ type: "resolve-selection-candidate", tabId, candidateIndex }); }
async function cancelCapture(tabId: number): Promise<void> { await sendRuntimeRequest({ type: "cancel-capture", tabId }); }
async function sendRuntimeRequest(message: Record<string, unknown>): Promise<void> {
  const response = await browser.runtime.sendMessage(message) as { ok?: boolean; error?: string } | undefined;
  if (!response?.ok) {
    const workspaceId = useSidePanelStore.getState().activeWorkspaceId;
    if (workspaceId) useSidePanelStore.getState().setActionError(workspaceId, response?.error ?? "Chrome拡張機能の処理に失敗しました");
  }
}

/** Keep active-tab capture metadata and active Reader Workspace selection synchronized independently. */
function useBrowserContext() {
  const queryClient = useQueryClient();
  const setActiveTabId = useSidePanelStore((state) => state.setActiveTabId);
  const setTabState = useSidePanelStore((state) => state.setTabState);
  const setActiveWorkspaceId = useSidePanelStore((state) => state.setActiveWorkspaceId);
  useEffect(() => {
    let disposed = false;
    const load = async (tabId?: number) => {
      const resolvedTabId = tabId ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id ?? null;
      const [capture, workspaceId] = await Promise.all([
        resolvedTabId === null ? Promise.resolve(null) : getTabState(resolvedTabId),
        getActiveWorkspaceId(),
      ]);
      if (disposed) return;
      setActiveTabId(resolvedTabId);
      setTabState(capture);
      setActiveWorkspaceId(workspaceId);
    };
    void load();
    const activated = ({ tabId }: { tabId: number }) => { void load(tabId); };
    const updated = (tabId: number, changeInfo: { url?: string; status?: string }) => {
      if (tabId === useSidePanelStore.getState().activeTabId && (changeInfo.url || changeInfo.status === "complete")) void load(tabId);
    };
    const storageChanged = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
      if (area !== "local" || !isLensmapStorageChange(changes)) return;
      void load(useSidePanelStore.getState().activeTabId ?? undefined);
      if ("lensmap.workspaceRevision" in changes) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["workspace"] }),
          queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
          queryClient.invalidateQueries({ queryKey: ["maps"] }),
        ]);
      }
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
  }, [queryClient, setActiveTabId, setActiveWorkspaceId, setTabState]);
}
