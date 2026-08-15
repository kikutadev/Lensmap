import { randomUUID } from "node:crypto";
import {
  mapArtifactDetailSchema,
  mapArtifactSchema,
  mapDraftSchema,
  mapListResponseSchema,
  mapVersionDiffResponseSchema,
  mapVersionHistoryResponseSchema,
  type CreateMapFromMessageRequest,
  type MapArtifact,
  type MapArtifactDetail,
  type MapDraft,
  type MapListResponse,
  type MapSemanticKind,
  type MapVersionDiffResponse,
  type MapVersionHistoryResponse,
  type StructuredMapBlock,
  type UpdateMapRequest,
} from "@lensmap/shared";
import type { ExploreRepository } from "../explore/explore-repository.js";
import type { WorkspaceService } from "../workspaces/workspace-service.js";
import { MapRepository, type MapArtifactRecord, type MapVersionRecord, type NewMapBlock } from "./map-repository.js";
import { parseMarkdownMapBlocks } from "./markdown-map-parser.js";

/** Materialize every completed Explore answer into one idempotent, versioned MapArtifact. */
export class MapService {
  public constructor(
    private readonly repository: MapRepository,
    private readonly exploreRepository: ExploreRepository,
    private readonly workspaceService: WorkspaceService,
  ) {}

  /** Prefer the validated same-turn structured draft; retain Markdown parsing as a resilience fallback. */
  public createFromMessage(input: CreateMapFromMessageRequest, draftInput?: MapDraft | null): MapArtifactDetail {
    const message = this.exploreRepository.findMessageById(input.messageId);
    if (!message) throw new Error("Explore message not found");
    if (message.role !== "assistant") throw new Error("Only assistant messages can become Maps");
    if (message.status !== "completed") throw new Error("Only completed assistant messages can become Maps");
    if (!message.content.trim()) throw new Error("Empty assistant messages cannot become Maps");

    if (message.codexTurnId) {
      const existingMapId = this.repository.findMapIdByOriginTurnId(message.codexTurnId);
      if (existingMapId) return this.getDetail(existingMapId);
    }

    const thread = this.exploreRepository.findThreadById(message.threadId);
    if (!thread) throw new Error("Origin Explore thread not found");
    this.workspaceService.get(thread.workspaceId);
    const messageSources = this.exploreRepository.listMessageSources(message.id);
    const sourceByLabel = new Map(messageSources.map((source) => [source.sourceLabel, source.sourceAnchorId]));
    const draft = draftInput ? validateDraftAgainstSources(draftInput, sourceByLabel) : null;

    const built = draft
      ? materializeDraft(draft, sourceByLabel)
      : materializeMarkdownFallback(message.content, messageSources);
    const title = input.title?.trim() || built.title;
    const conciseExplanation = built.conciseExplanation || deriveConciseExplanation(message.content);
    const now = new Date().toISOString();
    const mapArtifactId = randomUUID();
    const blocks = built.blocks.map((block, index): NewMapBlock => ({ ...block, id: randomUUID(), blockOrder: index }));
    const primaryBlockId = blocks[built.primaryBlockIndex]?.id ?? blocks[0]?.id ?? null;
    const sourceAnchorIds = [...new Set([
      ...built.sourceAnchorIds,
      ...blocks.flatMap((block) => block.sourceRefs.map((ref) => ref.sourceAnchorId)),
    ])];

    this.repository.create({
      id: mapArtifactId,
      workspaceId: thread.workspaceId,
      title,
      preview: conciseExplanation.slice(0, 220),
      conciseExplanation,
      createdBy: "ai",
      createdAt: now,
      updatedAt: now,
      tags: [],
      versionId: randomUUID(),
      semanticKind: built.semanticKind,
      primaryBlockId,
      sourceAnchorIds,
      originTurnIds: message.codexTurnId ? [message.codexTurnId] : [],
      blocks,
    });
    return this.getDetail(mapArtifactId);
  }

  /** Append an immutable MapVersion for user edits instead of destructively mutating the current version. */
  public update(mapArtifactId: string, input: UpdateMapRequest): MapArtifactDetail {
    const record = this.repository.findById(mapArtifactId);
    if (!record) throw new Error("Map not found");
    const latest = this.repository.findLatestVersion(mapArtifactId);
    if (!latest) throw new Error("Map has no versions");
    const currentBlocks = this.repository.listBlocks(latest.id);
    const edits = new Map((input.blocks ?? []).map((block) => [block.id, block.content]));
    for (const blockId of edits.keys()) {
      if (!currentBlocks.some((block) => block.id === blockId)) throw new Error(`Map block not found in latest version: ${blockId}`);
    }

    const primaryOrder = currentBlocks.find((block) => block.id === latest.primaryBlockId)?.blockOrder ?? currentBlocks[0]?.blockOrder ?? null;
    const blocks: NewMapBlock[] = currentBlocks.map((block) => {
      const sourceRefs = this.repository.listBlockSourceRefs(block.id);
      const currentContent = parseJson(block.contentJson);
      const nextContent = edits.has(block.id) ? edits.get(block.id) : currentContent;
      const changed = edits.has(block.id) && !sameJson(currentContent, nextContent);
      return {
        id: randomUUID(),
        kind: block.kind,
        blockOrder: block.blockOrder,
        contentJson: JSON.stringify(nextContent),
        groundingKind: block.groundingKind,
        groundingStatus: changed ? (sourceRefs.length > 0 ? "modified" : "needs-review") : block.groundingStatus,
        sourceRefs,
      };
    });
    const createdAt = new Date().toISOString();
    const conciseExplanation = input.conciseExplanation?.trim() ?? latest.conciseExplanation;
    const primaryBlockId = primaryOrder === null ? null : blocks.find((block) => block.blockOrder === primaryOrder)?.id ?? null;
    this.repository.createVersion({
      mapArtifactId,
      title: input.title?.trim() || record.title,
      conciseExplanation,
      preview: conciseExplanation.slice(0, 220),
      createdAt,
      versionId: randomUUID(),
      version: latest.version + 1,
      semanticKind: latest.semanticKind,
      primaryBlockId,
      ...(input.tags ? { tags: normalizeTags(input.tags) } : {}),
      blocks,
    });
    return this.getDetail(mapArtifactId);
  }

  public listVersions(mapArtifactId: string): MapVersionHistoryResponse {
    if (!this.repository.findById(mapArtifactId)) throw new Error("Map not found");
    return mapVersionHistoryResponseSchema.parse({
      versions: this.repository.listVersions(mapArtifactId).map(({ id, version, semanticKind, primaryBlockId, createdAt }) => ({
        id, version, semanticKind, primaryBlockId, createdAt,
      })),
    });
  }

  public getVersionDetail(mapArtifactId: string, version: number): MapArtifactDetail {
    const record = this.repository.findById(mapArtifactId);
    if (!record) throw new Error("Map not found");
    const versionRecord = this.repository.findVersion(mapArtifactId, version);
    if (!versionRecord) throw new Error("Map version not found");
    return mapArtifactDetailSchema.parse({ artifact: this.toArtifact(record, versionRecord), sources: this.repository.listMapSources(mapArtifactId).map(toMapSource) });
  }

  public diffVersions(mapArtifactId: string, fromVersion: number, toVersion: number): MapVersionDiffResponse {
    const from = this.repository.findVersion(mapArtifactId, fromVersion);
    const to = this.repository.findVersion(mapArtifactId, toVersion);
    if (!from || !to) throw new Error("Map version not found");
    const before = new Map(this.repository.listBlocks(from.id).map((block) => [block.blockOrder, block]));
    const after = new Map(this.repository.listBlocks(to.id).map((block) => [block.blockOrder, block]));
    const orders = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b);
    return mapVersionDiffResponseSchema.parse({
      fromVersion,
      toVersion,
      changes: orders.map((order) => {
        const left = before.get(order);
        const right = after.get(order);
        if (!left && right) return { order, kind: right.kind, change: "added" as const, afterContent: parseJson(right.contentJson) };
        if (left && !right) return { order, kind: left.kind, change: "removed" as const, beforeContent: parseJson(left.contentJson) };
        const beforeContent = parseJson(left!.contentJson);
        const afterContent = parseJson(right!.contentJson);
        return { order, kind: right!.kind, change: sameJson(beforeContent, afterContent) ? "unchanged" as const : "modified" as const, beforeContent, afterContent };
      }),
    });
  }

  public listByWorkspace(workspaceId: string): MapListResponse {
    this.workspaceService.get(workspaceId);
    const artifacts = this.repository.listByWorkspace(workspaceId).map((record) => {
      const artifact = this.toArtifact(record);
      const provenance = this.repository.listMapSources(record.id);
      const sourceBooks = [...new Map(provenance.map((source) => [source.bookId, source.bookTitle])).entries()].map(([bookId, title]) => ({
        bookId,
        title,
        pages: [...new Set(provenance.filter((source) => source.bookId === bookId).flatMap(sourcePageNumber))].sort((a, b) => a - b),
      }));
      const primaryBlock = artifact.blocks.find((block) => block.id === artifact.primaryBlockId) ?? artifact.blocks[0] ?? null;
      const primaryVisual = artifact.blocks.find((block) => ["diagram", "chart", "table", "visual-reference"].includes(block.kind));
      return {
        ...artifact,
        sourceCount: artifact.sourceAnchorIds.length,
        sourcePages: [...new Set(provenance.flatMap(sourcePageNumber))].sort((a, b) => a - b),
        sourceBooks,
        preview: record.preview || artifact.conciseExplanation.slice(0, 220),
        primaryBlock,
        primaryVisualKind: primaryVisual && primaryVisual.kind !== "definition" && primaryVisual.kind !== "narrative" && primaryVisual.kind !== "callout" ? primaryVisual.kind : null,
        primaryVisualSource: primaryBlock?.kind === "visual-reference"
          ? (() => {
            const visual = provenance.find((source) => source.kind === "visual" && source.imageAssetId);
            return visual ? { bookId: visual.bookId, imageAssetId: visual.imageAssetId!, page: visual.visualPage, recognizedText: visual.recognizedText } : null;
          })()
          : null,
      };
    });
    return mapListResponseSchema.parse({ artifacts });
  }

  public getDetail(mapArtifactId: string): MapArtifactDetail {
    const record = this.repository.findById(mapArtifactId);
    if (!record) throw new Error("Map not found");
    return mapArtifactDetailSchema.parse({ artifact: this.toArtifact(record), sources: this.repository.listMapSources(mapArtifactId).map(toMapSource) });
  }

  private toArtifact(record: MapArtifactRecord, requestedVersion?: MapVersionRecord): MapArtifact {
    const version = requestedVersion ?? this.repository.findLatestVersion(record.id);
    if (!version) throw new Error(`Map has no versions: ${record.id}`);
    const blocks = this.repository.listBlocks(version.id).map((block) => {
      const sourceRefs = this.repository.listBlockSourceRefs(block.id);
      return {
        id: block.id,
        kind: block.kind,
        order: block.blockOrder,
        content: parseJson(block.contentJson),
        sourceAnchorIds: sourceRefs.map((sourceRef) => sourceRef.sourceAnchorId),
        sourceRefs,
        groundingKind: block.groundingKind,
        groundingStatus: block.groundingStatus,
      };
    });
    return mapArtifactSchema.parse({
      id: record.id,
      workspaceId: record.workspaceId,
      title: version.title ?? record.title,
      conciseExplanation: version.conciseExplanation,
      sourceAnchorIds: this.repository.listMapSourceIds(record.id),
      originTurnIds: this.repository.listOriginTurnIds(record.id),
      createdBy: record.createdBy,
      tags: parseTags(record.tagsJson),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      version: version.version,
      semanticKind: version.semanticKind,
      primaryBlockId: version.primaryBlockId,
      blocks,
    });
  }
}

type MaterializedBlock = Omit<NewMapBlock, "id" | "blockOrder">;

interface MaterializedMap {
  title: string;
  conciseExplanation: string;
  semanticKind: MapSemanticKind;
  primaryBlockIndex: number;
  sourceAnchorIds: string[];
  blocks: MaterializedBlock[];
}

function validateDraftAgainstSources(draftInput: MapDraft, sourceByLabel: Map<string, string>): MapDraft {
  const draft = mapDraftSchema.parse(draftInput);
  const labels = new Set([
    ...draft.sourceRefs,
    ...draft.primary.sourceRefs,
    ...draft.supportingBlocks.flatMap((block) => block.sourceRefs),
  ]);
  const invalid = [...labels].filter((label) => !sourceByLabel.has(label));
  if (invalid.length) throw new Error(`Map Draft contains unknown source labels: ${invalid.join(", ")}`);
  return draft;
}

function materializeDraft(draft: MapDraft, sourceByLabel: Map<string, string>): MaterializedMap {
  const structured = [draft.primary, ...draft.supportingBlocks];
  const blocks = structured.map((block) => materializeStructuredBlock(block, sourceByLabel));
  const sourceAnchorIds = [...new Set(draft.sourceRefs.flatMap((label) => sourceByLabel.get(label) ?? []))];
  return {
    title: draft.title,
    conciseExplanation: draft.conciseExplanation,
    semanticKind: draft.semanticKind,
    primaryBlockIndex: 0,
    sourceAnchorIds,
    blocks,
  };
}

function materializeStructuredBlock(block: StructuredMapBlock, sourceByLabel: Map<string, string>): MaterializedBlock {
  const sourceRefs = block.sourceRefs.flatMap((label) => {
    const sourceAnchorId = sourceByLabel.get(label);
    return sourceAnchorId ? [{ label, sourceAnchorId }] : [];
  });
  const groundingKind = sourceRefs.length > 0 ? "source-backed" as const : "ai-explanation" as const;
  const groundingStatus = sourceRefs.length > 0 ? "references-checked" as const : "needs-review" as const;
  if (block.type === "narrative") {
    return { kind: "narrative", contentJson: JSON.stringify({ markdown: block.body, title: block.title }), groundingKind, groundingStatus, sourceRefs };
  }
  const kind = block.type === "definition" ? "definition" as const
    : block.type === "table" ? "table" as const
      : block.type === "chart" ? "chart" as const
        : block.type === "callout" ? "callout" as const
          : "diagram" as const;
  return {
    kind,
    contentJson: JSON.stringify({ format: "visualization", visualization: block }),
    groundingKind,
    groundingStatus,
    sourceRefs,
  };
}

function materializeMarkdownFallback(messageContent: string, messageSources: ReturnType<ExploreRepository["listMessageSources"]>): MaterializedMap {
  const parsedBlocks = parseMarkdownMapBlocks(
    messageContent,
    messageSources.map((source) => ({ label: source.sourceLabel, sourceAnchorId: source.sourceAnchorId })),
  );
  const visualBlocks = messageSources
    .filter((source) => source.kind === "visual" && messageContent.includes(`[${source.sourceLabel}]`))
    .slice(0, 3)
    .map((source): MaterializedBlock => ({
      kind: "visual-reference",
      contentJson: JSON.stringify({
        imageAssetId: source.imageAssetId,
        bookId: source.bookId,
        bookTitle: source.bookTitle,
        page: source.visualPage,
        recognizedText: source.recognizedText,
      }),
      sourceRefs: [{ label: source.sourceLabel, sourceAnchorId: source.sourceAnchorId }],
      groundingKind: "source-backed",
      groundingStatus: "references-checked",
    }));
  const parsed = parsedBlocks.map((block): MaterializedBlock => ({
    kind: block.kind,
    contentJson: JSON.stringify(block.content),
    groundingKind: block.groundingKind,
    groundingStatus: block.groundingStatus,
    sourceRefs: block.sourceRefs,
  }));
  const blocks = [...visualBlocks, ...parsed];
  const semanticKind = inferSemanticKind(blocks);
  return {
    title: deriveTitle(messageContent),
    conciseExplanation: deriveConciseExplanation(messageContent),
    semanticKind,
    primaryBlockIndex: chooseFallbackPrimaryIndex(blocks, semanticKind),
    sourceAnchorIds: [],
    blocks,
  };
}

function chooseFallbackPrimaryIndex(blocks: MaterializedBlock[], semanticKind: MapSemanticKind): number {
  if (blocks.length === 0) return 0;
  const preferredKinds = semanticKind === "comparison" ? ["table", "diagram"]
    : semanticKind === "quantitative" ? ["chart", "table"]
      : ["diagram", "table", "chart", "narrative", "visual-reference"];
  for (const kind of preferredKinds) {
    const index = blocks.findIndex((block) => block.kind === kind);
    if (index >= 0) return index;
  }
  return 0;
}

function inferSemanticKind(blocks: MaterializedBlock[]): MapSemanticKind {
  for (const block of blocks) {
    const content = parseJson(block.contentJson);
    if (content && typeof content === "object" && !Array.isArray(content)) {
      const visualization = (content as Record<string, unknown>).visualization;
      if (visualization && typeof visualization === "object" && !Array.isArray(visualization)) {
        const type = (visualization as Record<string, unknown>).type;
        if (type === "definition") return "definition";
        if (type === "comparison" || type === "table" || type === "matrix") return "comparison";
        if (type === "flow") return "process";
        if (type === "hierarchy") return "hierarchy";
        if (type === "timeline") return "timeline";
        if (type === "chart") return "quantitative";
      }
    }
    if (block.kind === "table") return "comparison";
    if (block.kind === "chart") return "quantitative";
  }
  return "synthesis";
}

function toMapSource(source: ReturnType<MapRepository["listMapSources"]>[number]) {
  return source.kind === "visual"
    ? {
      kind: "visual" as const,
      sourceAnchorId: source.sourceAnchorId,
      bookId: source.bookId,
      bookTitle: source.bookTitle,
      imageAssetId: source.imageAssetId!,
      locationStatus: source.locationStatus ?? "unresolved",
      page: source.visualPage,
      recognizedText: source.recognizedText,
      origin: source.origin,
    }
    : {
      kind: "text" as const,
      sourceAnchorId: source.sourceAnchorId,
      bookId: source.bookId,
      bookTitle: source.bookTitle,
      pageStart: source.pageStart,
      pageEnd: source.pageEnd,
      printedPageLabelStart: source.printedPageLabelStart,
      printedPageLabelEnd: source.printedPageLabelEnd,
      quoteRaw: source.quoteRaw,
      origin: source.origin,
    };
}

function sourcePageNumber(source: ReturnType<MapRepository["listMapSources"]>[number]): number[] {
  const pageIndex = source.kind === "visual" ? source.visualPage : source.pageStart;
  return pageIndex === null ? [] : [pageIndex + 1];
}

function deriveTitle(markdown: string): string {
  const heading = markdown.match(/^#{1,6}\s+(.+)$/m)?.[1];
  const bold = markdown.match(/\*\*([^*\n]{3,120})\*\*/)?.[1];
  const firstMeaningfulLine = markdown.replace(/```[\s\S]*?```/g, " ").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  const candidate = heading ?? bold ?? firstMeaningfulLine ?? "Map";
  const cleaned = candidate.replace(/^\d+[.)]\s*/, "").replace(/^[-*+]\s+/, "").replace(/\[S\d+\]/g, "").replace(/[*_`#]/g, "").trim();
  return (cleaned.split(/[。.!?]/u)[0]?.trim() || "Map").slice(0, 80);
}

function deriveConciseExplanation(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/gu, " ").replace(/\[S\d+\]/gu, " ").replace(/[#>*_`|~-]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 800);
}
function normalizeTags(tags: string[]): string[] { return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20); }
function parseTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? normalizeTags(parsed.filter((item): item is string => typeof item === "string")) : [];
  } catch { return []; }
}
function sameJson(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return { markdown: value }; }
}
