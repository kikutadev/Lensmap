import type { MapBlock, ExploreMessageSource, MapArtifactDetail } from "@lensmap/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GitCompareArrows, History, LoaderCircle, Pencil, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  fetchMapDetail,
  fetchMapDiff,
  fetchMapVersion,
  fetchMapVersions,
  fetchVisualSourceAsset,
  updateMap,
} from "../../lib/api";
import { LazyVisualizationBlock } from "./rich/LazyVisualizationBlock";
import { MermaidDiagram } from "./rich/MermaidDiagram";
import { RichMessage } from "./rich/RichMessage";
import { SourceReference } from "./rich/SourceReference";

interface Props {
  mapArtifactId: string;
  onBack: () => void;
  onOpenSource: (bookId: string, page: number) => void;
}

export function MapDetail({ mapArtifactId, onBack, onOpenSource }: Props) {
  const queryClient = useQueryClient();
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [blockDrafts, setBlockDrafts] = useState<Record<string, string>>({});
  const [editError, setEditError] = useState<string | null>(null);

  const latest = useQuery({
    queryKey: ["map", mapArtifactId],
    queryFn: ({ signal }) => fetchMapDetail(mapArtifactId, signal),
  });
  const versions = useQuery({
    queryKey: ["map-versions", mapArtifactId],
    queryFn: ({ signal }) => fetchMapVersions(mapArtifactId, signal),
  });
  const viewed = useQuery({
    queryKey: ["map-version", mapArtifactId, selectedVersion],
    queryFn: ({ signal }) => fetchMapVersion(mapArtifactId, selectedVersion!, signal),
    enabled: selectedVersion !== null && selectedVersion !== latest.data?.artifact.version,
  });
  const detail = selectedVersion !== null && selectedVersion !== latest.data?.artifact.version ? viewed.data : latest.data;
  const effectiveVersion = detail?.artifact.version ?? null;
  const previousVersion = effectiveVersion && effectiveVersion > 1 ? effectiveVersion - 1 : null;
  const diff = useQuery({
    queryKey: ["map-diff", mapArtifactId, previousVersion, effectiveVersion],
    queryFn: ({ signal }) => fetchMapDiff(mapArtifactId, previousVersion!, effectiveVersion!, signal),
    enabled: previousVersion !== null && effectiveVersion !== null,
  });

  useEffect(() => {
    if (!latest.data || selectedVersion !== null) return;
    setSelectedVersion(latest.data.artifact.version);
  }, [latest.data, selectedVersion]);

  const save = useMutation({
    mutationFn: async () => {
      if (!latest.data) throw new Error("Mapを読み込めませんでした");
      const blocks = latest.data.artifact.blocks.map((block) => ({
        id: block.id,
        content: parseEditedContent(block.content, blockDrafts[block.id] ?? serializeContent(block.content)),
      }));
      return updateMap(mapArtifactId, {
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
        queryClient.invalidateQueries({ queryKey: ["map", mapArtifactId] }),
        queryClient.invalidateQueries({ queryKey: ["map-versions", mapArtifactId] }),
        queryClient.invalidateQueries({ queryKey: ["maps"] }),
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

  if (latest.isLoading) return <LoaderBlock label="Mapを読み込み中…" />;
  if (!detail) return <div className="capture-status error">Mapを読み込めませんでした。</div>;
  const isLatest = detail.artifact.version === latest.data?.artifact.version;
  const hasPrimaryVisual = detail.artifact.blocks.some((block) => ["table", "diagram", "chart", "visual-reference"].includes(block.kind));

  return (
    <div className="map-detail">
      <div className="map-toolbar">
        <button className="back-button" onClick={onBack}><ArrowLeft size={14} />一覧へ</button>
        {isLatest && !editing ? <button className="secondary-button" onClick={startEdit}><Pencil size={13} />編集</button> : null}
      </div>

      {editing ? (
        <section className="map-editor">
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
          <div className="map-meta">v{detail.artifact.version} · {detail.artifact.sourceAnchorIds.length} refs</div>
          {detail.artifact.conciseExplanation && hasPrimaryVisual ? <p className="map-concise-explanation">{detail.artifact.conciseExplanation}</p> : null}
          {detail.artifact.tags.length ? <div className="tag-row">{detail.artifact.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}

          <div className="version-row" aria-label="Map versions">
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

          {detail.artifact.blocks.map((block) => <MapBlockView key={block.id} block={block} detail={detail} onOpenSource={onOpenSource} />)}
        </>
      )}
    </div>
  );
}

function MapBlockView({ block, detail, onOpenSource }: { block: MapBlock; detail: MapArtifactDetail; onOpenSource: (bookId: string, page: number) => void }) {
  const exploreSources = useMemo(() => block.sourceRefs.flatMap((ref): ExploreMessageSource[] => {
    const source = detail.sources.find((candidate) => candidate.sourceAnchorId === ref.sourceAnchorId);
    if (!source) return [];
    if (source.kind === "visual") {
      return [{
        kind: "visual",
        label: ref.label,
        sourceAnchorId: source.sourceAnchorId,
        bookId: source.bookId,
        bookTitle: source.bookTitle,
        imageAssetId: source.imageAssetId,
        locationStatus: source.locationStatus,
        page: source.page,
        recognizedText: source.recognizedText,
        includedText: source.recognizedText ?? "",
        truncated: false,
        origin: source.origin,
      }];
    }
    return [{
      kind: "text",
      label: ref.label,
      sourceAnchorId: source.sourceAnchorId,
      bookId: source.bookId,
      bookTitle: source.bookTitle,
      pageStart: source.pageStart,
      pageEnd: source.pageEnd,
      printedPageLabelStart: source.printedPageLabelStart,
      printedPageLabelEnd: source.printedPageLabelEnd,
      quoteRaw: source.quoteRaw,
      includedText: source.quoteRaw,
      truncated: false,
      origin: source.origin,
    }];
  }), [block.sourceRefs, detail.sources]);

  const open = (source: ExploreMessageSource) => {
    if (source.kind === "text") onOpenSource(source.bookId, source.pageStart + 1);
    else if (source.page !== null) onOpenSource(source.bookId, source.page + 1);
  };
  return (
    <article className={`map-block ${block.kind}`}>
      {block.groundingKind === "ai-explanation" ? <div className="map-provenance-note">書籍本文の直接引用を伴わないAI補足</div> : null}
      {block.groundingStatus === "modified" ? <div className="map-provenance-note modified">編集済み · 引用は元回答時点の根拠です</div> : null}
      <MapBlockContent block={block} sources={exploreSources} onOpenSource={open} />
      {exploreSources.length > 0 ? (
        <div className="citation-row map-citations">
          {exploreSources.map((source) => <SourceReference key={`${block.id}-${source.label}`} source={source} onOpen={open} variant="chip" />)}
        </div>
      ) : null}
    </article>
  );
}

function MapBlockContent({ block, sources, onOpenSource }: { block: MapBlock; sources: ExploreMessageSource[]; onOpenSource: (source: ExploreMessageSource) => void }) {
  const content = asRecord(block.content);
  if (block.kind === "visual-reference" && typeof content?.bookId === "string" && typeof content.imageAssetId === "string") {
    return <MapVisualReference bookId={content.bookId} imageAssetId={content.imageAssetId} recognizedText={typeof content.recognizedText === "string" ? content.recognizedText : null} />;
  }
  if (typeof block.content === "string") return <RichMessage markdown={block.content} sources={sources} onOpenSource={onOpenSource} />;
  if (typeof content?.markdown === "string") return <RichMessage markdown={content.markdown} sources={sources} onOpenSource={onOpenSource} />;
  if (content?.format === "mermaid" && typeof content.source === "string") return <MermaidDiagram source={content.source} />;
  if (content?.format === "visualization" && content.visualization !== undefined) return <LazyVisualizationBlock json={JSON.stringify(content.visualization)} sources={sources} onOpenSource={onOpenSource} />;
  return <pre className="rich-pre">{serializeContent(block.content)}</pre>;
}

function MapVisualReference({ bookId, imageAssetId, recognizedText }: { bookId: string; imageAssetId: string; recognizedText: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void fetchVisualSourceAsset(bookId, imageAssetId, controller.signal).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bookId, imageAssetId]);
  return <figure className="map-visual-reference">{url ? <img src={url} alt={recognizedText || "Visual Source"} /> : <div className="map-visual-placeholder">Visual Source</div>}{recognizedText ? <figcaption>{recognizedText}</figcaption> : null}</figure>;
}

function parseEditedContent(original: unknown, draft: string): unknown {
  if (typeof original === "string") return draft;
  try { return JSON.parse(draft); } catch { throw new Error("構造化blockは有効なJSONとして編集してください。"); }
}
function serializeContent(value: unknown): string { return typeof value === "string" ? value : JSON.stringify(value, null, 2); }
function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function LoaderBlock({ label }: { label: string }) { return <div className="loader-block"><LoaderCircle className="spin" size={15} />{label}</div>; }
