import { randomUUID } from "node:crypto";
import {
  mapArtifactDetailSchema,
  mapArtifactSchema,
  mapListResponseSchema,
  mapVersionDiffResponseSchema,
  mapVersionHistoryResponseSchema,
  type CreateMapFromMessageRequest,
  type MapArtifact,
  type MapArtifactDetail,
  type MapListResponse,
  type MapVersionDiffResponse,
  type MapVersionHistoryResponse,
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

  public createFromMessage(input: CreateMapFromMessageRequest): MapArtifactDetail {
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
    const parsedBlocks = parseMarkdownMapBlocks(
      message.content,
      messageSources.map((source) => ({ label: source.sourceLabel, sourceAnchorId: source.sourceAnchorId })),
    );
    const visualBlocks = messageSources
      .filter((source) => source.kind === "visual" && message.content.includes(`[${source.sourceLabel}]`))
      .slice(0, 3)
      .map((source) => ({
        kind: "visual-reference" as const,
        content: {
          imageAssetId: source.imageAssetId,
          bookId: source.bookId,
          bookTitle: source.bookTitle,
          page: source.visualPage,
          recognizedText: source.recognizedText,
        },
        sourceAnchorIds: [source.sourceAnchorId],
        sourceRefs: [{ label: source.sourceLabel, sourceAnchorId: source.sourceAnchorId }],
        groundingKind: "source-backed" as const,
        groundingStatus: "references-checked" as const,
      }));
    const mapBlocks = [...visualBlocks, ...parsedBlocks];
    const sourceAnchorIds = [...new Set(mapBlocks.flatMap((block) => block.sourceAnchorIds))];
    const conciseExplanation = deriveConciseExplanation(message.content);
    const title = input.title?.trim() || deriveTitle(message.content);
    const now = new Date().toISOString();
    const mapArtifactId = randomUUID();

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
      sourceAnchorIds,
      originTurnIds: message.codexTurnId ? [message.codexTurnId] : [],
      blocks: mapBlocks.map((block, index): NewMapBlock => ({
        id: randomUUID(),
        kind: block.kind,
        blockOrder: index,
        contentJson: JSON.stringify(block.content),
        groundingKind: block.groundingKind,
        groundingStatus: block.groundingStatus,
        sourceRefs: block.sourceRefs,
      })),
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
    this.repository.createVersion({
      mapArtifactId,
      title: input.title?.trim() || record.title,
      conciseExplanation,
      preview: conciseExplanation.slice(0, 220),
      createdAt,
      versionId: randomUUID(),
      version: latest.version + 1,
      ...(input.tags ? { tags: normalizeTags(input.tags) } : {}),
      blocks,
    });
    return this.getDetail(mapArtifactId);
  }

  public listVersions(mapArtifactId: string): MapVersionHistoryResponse {
    if (!this.repository.findById(mapArtifactId)) throw new Error("Map not found");
    return mapVersionHistoryResponseSchema.parse({
      versions: this.repository.listVersions(mapArtifactId).map(({ id, version, createdAt }) => ({ id, version, createdAt })),
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
      const primaryVisual = artifact.blocks.find((block) => ["diagram", "chart", "table", "visual-reference"].includes(block.kind));
      return {
        ...artifact,
        sourceCount: artifact.sourceAnchorIds.length,
        sourcePages: [...new Set(provenance.flatMap(sourcePageNumber))].sort((a, b) => a - b),
        sourceBooks,
        preview: record.preview || artifact.conciseExplanation.slice(0, 220),
        primaryVisualKind: primaryVisual && primaryVisual.kind !== "narrative" && primaryVisual.kind !== "callout" ? primaryVisual.kind : null,
        primaryVisualSource: provenance.find((source) => source.kind === "visual" && source.imageAssetId)
          ? (() => {
            const visual = provenance.find((source) => source.kind === "visual" && source.imageAssetId)!;
            return { bookId: visual.bookId, imageAssetId: visual.imageAssetId!, page: visual.visualPage, recognizedText: visual.recognizedText };
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
      blocks,
    });
  }
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
