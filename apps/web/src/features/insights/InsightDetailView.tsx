import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, History, LoaderCircle, Pencil, Save, Sparkles, X } from "lucide-react";
import type { ChatMessageSource, InsightArtifactDetail } from "@deep-reader/shared";
import { fetchInsightDiff, fetchInsightVersion, fetchInsightVersions, updateInsight } from "../../lib/api";
import { MarkdownMessage } from "../chat/MarkdownMessage";
import { formatSourcePage } from "../chat/source-display";
import { MermaidDiagram } from "../rich-content/MermaidDiagram";
import { LazyVisualizationBlock } from "../rich-content/LazyVisualizationBlock";

interface Props {
  detail: InsightArtifactDetail;
  onBack: () => void;
  onOpenSource: (source: ChatMessageSource) => void;
  onStartDeepDive: (detail: InsightArtifactDetail) => void;
}

/** Inspect, edit and version a durable Insight without mutating prior versions. */
export function InsightDetailView({ detail, onBack, onOpenSource, onStartDeepDive }: Props) {
  const queryClient = useQueryClient();
  const [viewVersion, setViewVersion] = useState(detail.artifact.version);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(detail.artifact.title);
  const [tagsDraft, setTagsDraft] = useState(detail.artifact.tags.join(", "));
  const [blockDrafts, setBlockDrafts] = useState<Record<string, string>>({});
  const versions = useQuery({ queryKey: ["insight-versions", detail.artifact.id], queryFn: ({ signal }) => fetchInsightVersions(detail.artifact.id, signal) });
  const historical = useQuery({
    queryKey: ["insight-version", detail.artifact.id, viewVersion],
    queryFn: ({ signal }) => fetchInsightVersion(detail.artifact.id, viewVersion, signal),
    enabled: viewVersion !== detail.artifact.version,
  });
  const active = viewVersion === detail.artifact.version ? detail : historical.data ?? detail;
  const diff = useQuery({
    queryKey: ["insight-diff", detail.artifact.id, viewVersion - 1, viewVersion],
    queryFn: ({ signal }) => fetchInsightDiff(detail.artifact.id, viewVersion - 1, viewVersion, signal),
    enabled: viewVersion > 1,
  });
  const sourceById = useMemo(() => new Map(active.sources.map((source) => [source.sourceAnchorId, source])), [active.sources]);

  useEffect(() => {
    setViewVersion(detail.artifact.version);
    setTitleDraft(detail.artifact.title);
    setTagsDraft(detail.artifact.tags.join(", "));
    setEditing(false);
    setBlockDrafts({});
  }, [detail.artifact.id, detail.artifact.title, detail.artifact.version]);

  const save = useMutation({
    mutationFn: () => updateInsight(detail.artifact.id, {
      title: titleDraft,
      tags: tagsDraft.split(/[,、]/u).map((tag) => tag.trim()).filter(Boolean),
      blocks: detail.artifact.blocks.flatMap((block) => blockDrafts[block.id] === undefined ? [] : [{
        id: block.id,
        content: { markdown: blockDrafts[block.id] },
      }]),
    }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(["insight-detail", updated.artifact.id], updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["insight-versions", updated.artifact.id] }),
        queryClient.invalidateQueries({ queryKey: ["insights", updated.artifact.primaryBookId] }),
      ]);
      setEditing(false);
      setBlockDrafts({});
      setViewVersion(updated.artifact.version);
    },
  });

  const beginEdit = () => {
    setTitleDraft(detail.artifact.title);
    setTagsDraft(detail.artifact.tags.join(", "));
    setBlockDrafts(Object.fromEntries(detail.artifact.blocks.flatMap((block) => {
      const markdown = editableMarkdown(block.content);
      return markdown === null ? [] : [[block.id, markdown]];
    })));
    setEditing(true);
  };

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-2">
      <button className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800" onClick={onBack}><ArrowLeft size={13} />一覧へ</button>
      <div className="flex items-center gap-2">
        <button className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50" onClick={() => onStartDeepDive(active)}><Sparkles size={12} />このInsightを深掘り</button>
        {!editing && viewVersion === detail.artifact.version ? <button className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50" onClick={beginEdit}><Pencil size={12} />編集</button> : null}
      </div>
    </div>

    <div>
      {editing ? <div className="space-y-2">
        <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base font-semibold outline-none focus:border-slate-500" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} />
        <input aria-label="Insight tags" className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-slate-400" value={tagsDraft} onChange={(event) => setTagsDraft(event.target.value)} placeholder="tagをカンマ区切りで入力" />
      </div> : <h2 className="text-lg font-semibold tracking-tight text-slate-950">{active.artifact.title}</h2>}
      {!editing && active.artifact.tags.length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{active.artifact.tags.map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">#{tag}</span>)}</div> : null}
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        <span>{active.artifact.kind} · v{active.artifact.version} · {active.artifact.sourceAnchorIds.length} refs</span>
        <span className="inline-flex items-center gap-1"><History size={11} />{versions.data?.versions.length ?? 1} versions</span>
      </div>
    </div>

    {versions.data && versions.data.versions.length > 1 ? <div className="flex flex-wrap gap-1.5">
      {versions.data.versions.map((version) => <button key={version.id} disabled={editing} className={`rounded-full border px-2 py-0.5 text-[10px] ${viewVersion === version.version ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`} onClick={() => setViewVersion(version.version)}>v{version.version}</button>)}
    </div> : null}

    {viewVersion > 1 && diff.data ? <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
      <summary className="cursor-pointer font-medium">v{viewVersion - 1} → v{viewVersion} の変更</summary>
      <div className="mt-2 flex flex-wrap gap-1.5">{diff.data.changes.filter((change) => change.change !== "unchanged").map((change) => <span key={change.order} className="rounded bg-white px-2 py-1 ring-1 ring-slate-200">block {change.order + 1}: {change.change}</span>)}</div>
    </details> : null}

    {historical.isLoading ? <div className="flex justify-center py-8 text-slate-400"><LoaderCircle className="animate-spin" size={16} /></div> : <div className="space-y-3">
      {active.artifact.blocks.map((block) => {
        const blockSources = block.sourceRefs.flatMap((ref): ChatMessageSource[] => {
          const source = sourceById.get(ref.sourceAnchorId);
          return source ? [{ label: ref.label, sourceAnchorId: source.sourceAnchorId, bookId: source.bookId, pageStart: source.pageStart, pageEnd: source.pageEnd, printedPageLabelStart: source.printedPageLabelStart, printedPageLabelEnd: source.printedPageLabelEnd, quoteRaw: source.quoteRaw, includedText: source.quoteRaw, truncated: false, origin: source.origin }] : [];
        });
        const editable = editing && blockDrafts[block.id] !== undefined;
        return <section key={block.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2"><span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{block.kind}</span><GroundingBadge status={block.groundingStatus} /></div>
          {editable ? <textarea className="min-h-36 w-full resize-y rounded-lg border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-slate-400" value={blockDrafts[block.id]} onChange={(event) => setBlockDrafts((current) => ({ ...current, [block.id]: event.target.value }))} /> : <ArtifactBlockBody block={block} sources={blockSources} onOpenSource={onOpenSource} />}
          {blockSources.length > 0 ? <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">{blockSources.map((source) => <button key={`${block.id}-${source.label}`} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-50" onClick={() => onOpenSource(source)}>{source.label} · {formatSourcePage(source)}</button>)}</div> : null}
        </section>;
      })}
    </div>}

    {editing ? <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white/95 py-3 backdrop-blur">
      <button className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs" onClick={() => setEditing(false)}><X size={12} />キャンセル</button>
      <button disabled={save.isPending || !titleDraft.trim()} className="flex items-center gap-1 rounded-md bg-slate-950 px-3 py-1.5 text-xs text-white disabled:opacity-50" onClick={() => save.mutate()}>{save.isPending ? <LoaderCircle className="animate-spin" size={12} /> : <Save size={12} />}新しいversionとして保存</button>
    </div> : null}
  </div>;
}

function GroundingBadge({ status }: { status: InsightArtifactDetail["artifact"]["blocks"][number]["groundingStatus"] }) {
  const label = status === "claim-verified" ? "主張検証済み" : status === "references-checked" ? "参照確認済み" : status === "modified" ? "編集済み" : "要確認";
  const cls = status === "claim-verified" ? "bg-emerald-50 text-emerald-700" : status === "references-checked" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>;
}

function ArtifactBlockBody({ block, sources, onOpenSource }: { block: InsightArtifactDetail["artifact"]["blocks"][number]; sources: ChatMessageSource[]; onOpenSource: (source: ChatMessageSource) => void }) {
  const content = asRecord(block.content);
  if ((block.kind === "diagram" || block.kind === "chart") && content.format === "mermaid" && typeof content.source === "string") return <MermaidDiagram source={content.source} />;
  if ((block.kind === "diagram" || block.kind === "chart") && content.format === "visualization" && content.visualization !== undefined) return <LazyVisualizationBlock json={JSON.stringify(content.visualization)} sources={sources} onOpenSource={onOpenSource} />;
  const markdown = typeof content.markdown === "string" ? content.markdown : JSON.stringify(block.content, null, 2);
  return <MarkdownMessage markdown={markdown} sources={sources} onOpenSource={onOpenSource} />;
}

function editableMarkdown(content: unknown): string | null { const record = asRecord(content); return typeof record.markdown === "string" ? record.markdown : null; }
function asRecord(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
