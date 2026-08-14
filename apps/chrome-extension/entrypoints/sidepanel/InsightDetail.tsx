import type { ArtifactBlock, ChatMessageSource, InsightArtifactDetail } from "@deep-reader/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GitCompareArrows, History, LoaderCircle, Pencil, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  fetchInsightDetail,
  fetchInsightDiff,
  fetchInsightVersion,
  fetchInsightVersions,
  updateInsight,
} from "../../lib/api";
import { LazyVisualizationBlock } from "./rich/LazyVisualizationBlock";
import { MermaidDiagram } from "./rich/MermaidDiagram";
import { RichMessage } from "./rich/RichMessage";

interface Props {
  artifactId: string;
  onBack: () => void;
  onOpenPage: (page: number) => void;
}

export function InsightDetail({ artifactId, onBack, onOpenPage }: Props) {
  const queryClient = useQueryClient();
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [blockDrafts, setBlockDrafts] = useState<Record<string, string>>({});
  const [editError, setEditError] = useState<string | null>(null);

  const latest = useQuery({
    queryKey: ["insight", artifactId],
    queryFn: ({ signal }) => fetchInsightDetail(artifactId, signal),
  });
  const versions = useQuery({
    queryKey: ["insight-versions", artifactId],
    queryFn: ({ signal }) => fetchInsightVersions(artifactId, signal),
  });
  const viewed = useQuery({
    queryKey: ["insight-version", artifactId, selectedVersion],
    queryFn: ({ signal }) => fetchInsightVersion(artifactId, selectedVersion!, signal),
    enabled: selectedVersion !== null && selectedVersion !== latest.data?.artifact.version,
  });
  const detail = selectedVersion !== null && selectedVersion !== latest.data?.artifact.version ? viewed.data : latest.data;
  const effectiveVersion = detail?.artifact.version ?? null;
  const previousVersion = effectiveVersion && effectiveVersion > 1 ? effectiveVersion - 1 : null;
  const diff = useQuery({
    queryKey: ["insight-diff", artifactId, previousVersion, effectiveVersion],
    queryFn: ({ signal }) => fetchInsightDiff(artifactId, previousVersion!, effectiveVersion!, signal),
    enabled: previousVersion !== null && effectiveVersion !== null,
  });

  useEffect(() => {
    if (!latest.data || selectedVersion !== null) return;
    setSelectedVersion(latest.data.artifact.version);
  }, [latest.data, selectedVersion]);

  const save = useMutation({
    mutationFn: async () => {
      if (!latest.data) throw new Error("Insightを読み込めませんでした");
      const blocks = latest.data.artifact.blocks.map((block) => ({
        id: block.id,
        content: parseEditedContent(block.content, blockDrafts[block.id] ?? serializeContent(block.content)),
      }));
      return updateInsight(artifactId, {
        title: title.trim() || latest.data.artifact.title,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        blocks,
      });
    },
    onSuccess: async (result) => {
      setEditing(false);
      setEditError(null);
      setSelectedVersion(result.artifact.version);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["insight", artifactId] }),
        queryClient.invalidateQueries({ queryKey: ["insight-versions", artifactId] }),
        queryClient.invalidateQueries({ queryKey: ["insights"] }),
      ]);
    },
    onError: (error) => setEditError(error instanceof Error ? error.message : String(error)),
  });

  const startEdit = () => {
    if (!latest.data) return;
    setTitle(latest.data.artifact.title);
    setTags(latest.data.artifact.tags.join(", "));
    setBlockDrafts(Object.fromEntries(latest.data.artifact.blocks.map((block) => [block.id, serializeContent(block.content)])));
    setEditError(null);
    setEditing(true);
    setSelectedVersion(latest.data.artifact.version);
  };

  if (latest.isLoading) return <LoaderBlock label="Insightを読み込み中…" />;
  if (!detail) return <div className="capture-status error">Insightを読み込めませんでした。</div>;
  const isLatest = detail.artifact.version === latest.data?.artifact.version;

  return (
    <div className="insight-detail">
      <div className="insight-toolbar">
        <button className="back-button" onClick={onBack}><ArrowLeft size={14} />一覧へ</button>
        {isLatest && !editing ? <button className="secondary-button" onClick={startEdit}><Pencil size={13} />編集</button> : null}
      </div>

      {editing ? (
        <section className="insight-editor">
          <label>タイトル<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="architecture, cache" /></label>
          {latest.data!.artifact.blocks.map((block) => (
            <label key={block.id}>{block.kind}
              <textarea value={blockDrafts[block.id] ?? ""} onChange={(event) => setBlockDrafts((current) => ({ ...current, [block.id]: event.target.value }))} />
            </label>
          ))}
          {editError ? <div className="capture-status error">{editError}</div> : null}
          <div className="editor-actions">
            <button className="secondary-button" onClick={() => setEditing(false)}><X size={13} />キャンセル</button>
            <button className="primary-button" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <LoaderCircle className="spin" size={13} /> : <Save size={13} />}新しいversionとして保存</button>
          </div>
        </section>
      ) : (
        <>
          <h1>{detail.artifact.title}</h1>
          <div className="insight-meta">{detail.artifact.kind} · v{detail.artifact.version} · {detail.artifact.sourceAnchorIds.length} refs</div>
          {detail.artifact.tags.length ? <div className="tag-row">{detail.artifact.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}

          <div className="version-row" aria-label="Insight versions">
            <History size={13} />
            {versions.data?.versions.map((version) => (
              <button className={version.version === detail.artifact.version ? "active" : ""} key={version.id} onClick={() => { setEditing(false); setSelectedVersion(version.version); }}>v{version.version}</button>
            ))}
          </div>

          {diff.data ? (
            <details className="diff-panel">
              <summary><GitCompareArrows size={13} />v{diff.data.fromVersion} → v{diff.data.toVersion} の変更</summary>
              {diff.data.changes.filter((change) => change.change !== "unchanged").map((change) => <div key={`${change.order}-${change.kind}`}><strong>{change.kind} · {change.change}</strong><pre>{change.afterContent === undefined ? "(removed)" : serializeContent(change.afterContent)}</pre></div>)}
            </details>
          ) : null}

          {detail.artifact.blocks.map((block) => <InsightBlockView key={block.id} block={block} detail={detail} onOpenPage={onOpenPage} />)}
        </>
      )}
    </div>
  );
}

function InsightBlockView({ block, detail, onOpenPage }: { block: ArtifactBlock; detail: InsightArtifactDetail; onOpenPage: (page: number) => void }) {
  const chatSources = useMemo(() => block.sourceRefs.flatMap((ref): ChatMessageSource[] => {
    const source = detail.sources.find((candidate) => candidate.sourceAnchorId === ref.sourceAnchorId);
    return source ? [{
      label: ref.label,
      sourceAnchorId: source.sourceAnchorId,
      bookId: source.bookId,
      pageStart: source.pageStart,
      pageEnd: source.pageEnd,
      printedPageLabelStart: source.printedPageLabelStart,
      printedPageLabelEnd: source.printedPageLabelEnd,
      quoteRaw: source.quoteRaw,
      includedText: source.quoteRaw,
      truncated: false,
      origin: source.origin,
    }] : [];
  }), [block.sourceRefs, detail.sources]);

  const open = (source: ChatMessageSource) => onOpenPage(source.pageStart + 1);
  return (
    <article className="insight-block">
      <div className="insight-block-head"><span className="block-kind">{block.kind}</span><span className={`grounding ${block.groundingStatus}`}>{groundingLabel(block.groundingStatus)}</span></div>
      <InsightBlockContent block={block} sources={chatSources} onOpenSource={open} />
    </article>
  );
}

function InsightBlockContent({ block, sources, onOpenSource }: { block: ArtifactBlock; sources: ChatMessageSource[]; onOpenSource: (source: ChatMessageSource) => void }) {
  if (typeof block.content === "string") return <RichMessage markdown={block.content} sources={sources} onOpenSource={onOpenSource} />;
  const content = asRecord(block.content);
  if (content?.format === "mermaid" && typeof content.source === "string") return <MermaidDiagram source={content.source} />;
  if (content?.format === "visualization" && content.visualization !== undefined) return <LazyVisualizationBlock json={JSON.stringify(content.visualization)} sources={sources} onOpenSource={onOpenSource} />;
  return <pre className="rich-pre">{serializeContent(block.content)}</pre>;
}

function groundingLabel(value: ArtifactBlock["groundingStatus"]): string {
  if (value === "references-checked") return "参照確認済み";
  if (value === "claim-verified") return "主張検証済み";
  if (value === "modified") return "編集済み";
  return "要確認";
}

function parseEditedContent(original: unknown, draft: string): unknown {
  if (typeof original === "string") return draft;
  try { return JSON.parse(draft); } catch { throw new Error("構造化blockは有効なJSONとして編集してください。"); }
}
function serializeContent(value: unknown): string { return typeof value === "string" ? value : JSON.stringify(value, null, 2); }
function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function LoaderBlock({ label }: { label: string }) { return <div className="loader-block"><LoaderCircle className="spin" size={15} />{label}</div>; }
