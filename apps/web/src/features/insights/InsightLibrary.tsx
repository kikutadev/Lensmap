import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, LoaderCircle } from "lucide-react";
import type { ChatMessageSource, InsightArtifactDetail } from "@deep-reader/shared";
import { fetchInsightDetail, fetchInsights, fetchSourceAnchors } from "../../lib/api";
import { useReaderStore } from "../../store/reader-store";
import { useSourceDraftStore } from "../../store/source-draft-store";
import { InsightDetailView } from "./InsightDetailView";

interface InsightLibraryProps {
  bookId: string;
  onStartDeepDive?: () => void;
}

/** Browse durable Insights, restore their sources, and open a new Deep Dive from accumulated knowledge. */
export function InsightLibrary({ bookId, onStartDeepDive }: InsightLibraryProps) {
  const openSource = useReaderStore((state) => state.openSource);
  const clearSources = useSourceDraftStore((state) => state.clearSources);
  const attachSource = useSourceDraftStore((state) => state.attachSource);
  const requestComposerFocus = useSourceDraftStore((state) => state.requestComposerFocus);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const insights = useQuery({ queryKey: ["insights", bookId], queryFn: ({ signal }) => fetchInsights(bookId, signal) });
  const detail = useQuery({
    queryKey: ["insight-detail", selectedArtifactId],
    queryFn: ({ signal }) => fetchInsightDetail(selectedArtifactId!, signal),
    enabled: Boolean(selectedArtifactId),
  });
  const sourceAnchors = useQuery({ queryKey: ["source-anchors", bookId], queryFn: ({ signal }) => fetchSourceAnchors(bookId, signal) });

  const startDeepDive = (artifact: InsightArtifactDetail) => {
    const ids = new Set(artifact.artifact.sourceAnchorIds);
    const matched = (sourceAnchors.data ?? []).filter((source) => ids.has(source.id));
    clearSources();
    matched.forEach(attachSource);
    onStartDeepDive?.();
    requestComposerFocus();
  };

  if (selectedArtifactId) {
    if (detail.isLoading) return <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><LoaderCircle size={16} className="animate-spin" />Insightを読み込み中…</div>;
    if (detail.isError || !detail.data) return <div className="space-y-3 p-1"><button className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800" onClick={() => setSelectedArtifactId(null)}><ArrowLeft size={13} />一覧へ</button><div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Insightの読み込みに失敗しました。</div></div>;
    return <InsightDetailView
      detail={detail.data}
      onBack={() => setSelectedArtifactId(null)}
      onOpenSource={(source: ChatMessageSource) => openSource(source.sourceAnchorId, source.pageStart + 1)}
      onStartDeepDive={startDeepDive}
    />;
  }

  if (insights.isLoading) return <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><LoaderCircle size={16} className="animate-spin" />Insightsを読み込み中…</div>;
  const artifacts = insights.data?.artifacts ?? [];
  if (artifacts.length === 0) return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-500">Deep Diveの回答を「Insightに保存」すると、チャット履歴とは独立した知識成果物としてここに蓄積されます。</div>;

  const normalized = filter.trim().toLocaleLowerCase();
  const allTags = [...new Set(artifacts.flatMap((artifact) => artifact.tags))].sort();
  const filtered = artifacts.filter((artifact) => {
    const textMatch = !normalized || artifact.title.toLocaleLowerCase().includes(normalized) || artifact.tags.some((tag) => tag.toLocaleLowerCase().includes(normalized));
    const tagMatch = !tagFilter || artifact.tags.includes(tagFilter);
    return textMatch && tagMatch;
  });

  return <div className="space-y-3">
    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Saved Insights · {filtered.length}/{artifacts.length}</div>
    <input aria-label="Insight検索" value={filter} onChange={(event) => setFilter(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-400" placeholder="タイトル・tagで検索" />
    {allTags.length > 0 ? <div className="flex flex-wrap gap-1.5">
      <button className={`rounded-full px-2 py-0.5 text-[10px] ${tagFilter === null ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`} onClick={() => setTagFilter(null)}>すべて</button>
      {allTags.map((tag) => <button key={tag} className={`rounded-full px-2 py-0.5 text-[10px] ${tagFilter === tag ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`} onClick={() => setTagFilter(tag)}>#{tag}</button>)}
    </div> : null}
    {filtered.map((artifact) => <button key={artifact.id} className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50" onClick={() => setSelectedArtifactId(artifact.id)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-900">{artifact.title}</div><div className="mt-1 text-[11px] text-slate-400">{artifact.kind} · v{artifact.version}</div></div>
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-500"><FileText size={11} />{artifact.sourceCount} refs</div>
      </div>
    </button>)}
  </div>;
}
