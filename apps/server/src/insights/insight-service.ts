import { randomUUID } from "node:crypto";
import {
  insightArtifactDetailSchema,
  insightArtifactSchema,
  insightListResponseSchema,
  insightVersionDiffResponseSchema,
  insightVersionHistoryResponseSchema,
  type CreateInsightFromMessageRequest,
  type UpdateInsightRequest,
  type InsightArtifact,
  type InsightArtifactDetail,
  type InsightListResponse,
  type InsightVersionDiffResponse,
  type InsightVersionHistoryResponse,
} from "@deep-reader/shared";
import type { BookRepository } from "../books/book-repository.js";
import type { ChatRepository } from "../chat/chat-repository.js";
import { InsightRepository, type ArtifactVersionRecord, type InsightArtifactRecord } from "./insight-repository.js";
import { parseMarkdownArtifactBlocks } from "./markdown-artifact-parser.js";

/** Build durable, versioned knowledge artifacts from completed Deep Dive answers. */
export class InsightService {
  public constructor(
    private readonly repository: InsightRepository,
    private readonly chatRepository: ChatRepository,
    private readonly bookRepository: BookRepository,
  ) {}

  public createFromMessage(input: CreateInsightFromMessageRequest): InsightArtifactDetail {
    const message = this.chatRepository.findMessageById(input.messageId);
    if (!message) throw new Error("Chat message not found");
    if (message.role !== "assistant") throw new Error("Only assistant messages can be saved as Insights");
    if (message.status !== "completed") throw new Error("Only completed assistant messages can be saved as Insights");
    if (!message.content.trim()) throw new Error("Empty assistant messages cannot be saved as Insights");

    const thread = this.chatRepository.findThreadById(message.threadId);
    if (!thread) throw new Error("Origin chat thread not found");
    if (!this.bookRepository.findById(thread.bookId)) throw new Error("Origin book not found");

    const messageSources = this.chatRepository.listMessageSources(message.id);
    const parsedBlocks = parseMarkdownArtifactBlocks(
      message.content,
      messageSources.map((source) => ({ label: source.sourceLabel, sourceAnchorId: source.sourceAnchorId })),
    );
    const sourceAnchorIds = [...new Set(parsedBlocks.flatMap((block) => block.sourceAnchorIds))];
    const now = new Date().toISOString();
    const artifactId = randomUUID();
    const versionId = randomUUID();

    this.repository.create({
      id: artifactId,
      title: input.title?.trim() || deriveTitle(message.content),
      kind: "report",
      primaryBookId: thread.bookId,
      createdBy: "ai",
      createdAt: now,
      updatedAt: now,
      tags: [],
      versionId,
      sourceAnchorIds,
      originTurnIds: message.codexTurnId ? [message.codexTurnId] : [],
      blocks: parsedBlocks.map((block, index) => ({
        id: randomUUID(),
        kind: block.kind,
        blockOrder: index,
        contentJson: JSON.stringify(block.content),
        groundingKind: block.groundingKind,
        groundingStatus: block.groundingStatus,
        sourceAnchorIds: block.sourceAnchorIds,
        sourceRefs: block.sourceRefs,
      })),
    });

    return this.getDetail(artifactId);
  }

  /** Create a new immutable ArtifactVersion from user edits to title and/or existing blocks. */
  public update(artifactId: string, input: UpdateInsightRequest): InsightArtifactDetail {
    const record = this.repository.findById(artifactId);
    if (!record) throw new Error("Insight artifact not found");
    const latest = this.repository.findLatestVersion(artifactId);
    if (!latest) throw new Error("Insight artifact has no versions");
    const currentBlocks = this.repository.listBlocks(latest.id);
    const edits = new Map((input.blocks ?? []).map((block) => [block.id, block.content]));
    for (const blockId of edits.keys()) {
      if (!currentBlocks.some((block) => block.id === blockId)) throw new Error(`Insight block not found in latest version: ${blockId}`);
    }

    const blocks = currentBlocks.map((block) => {
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
        groundingStatus: changed ? (sourceRefs.length > 0 ? "modified" as const : "needs-review" as const) : block.groundingStatus,
        sourceAnchorIds: sourceRefs.map((sourceRef) => sourceRef.sourceAnchorId),
        sourceRefs,
      };
    });
    const createdAt = new Date().toISOString();
    this.repository.createVersion({
      artifactId,
      title: input.title?.trim() || record.title,
      createdAt,
      versionId: randomUUID(),
      version: latest.version + 1,
      ...(input.tags ? { tags: normalizeTags(input.tags) } : {}),
      blocks,
    });
    return this.getDetail(artifactId);
  }

  public listVersions(artifactId: string): InsightVersionHistoryResponse {
    if (!this.repository.findById(artifactId)) throw new Error("Insight artifact not found");
    return insightVersionHistoryResponseSchema.parse({
      versions: this.repository.listVersions(artifactId).map(({ id, version, createdAt }) => ({ id, version, createdAt })),
    });
  }

  public getVersionDetail(artifactId: string, version: number): InsightArtifactDetail {
    const record = this.repository.findById(artifactId);
    if (!record) throw new Error("Insight artifact not found");
    const versionRecord = this.repository.findVersion(artifactId, version);
    if (!versionRecord) throw new Error("Insight version not found");
    return insightArtifactDetailSchema.parse({
      artifact: this.toArtifact(record, versionRecord),
      sources: this.repository.listArtifactSources(artifactId),
    });
  }

  public diffVersions(artifactId: string, fromVersion: number, toVersion: number): InsightVersionDiffResponse {
    const from = this.repository.findVersion(artifactId, fromVersion);
    const to = this.repository.findVersion(artifactId, toVersion);
    if (!from || !to) throw new Error("Insight version not found");
    const before = new Map(this.repository.listBlocks(from.id).map((block) => [block.blockOrder, block]));
    const after = new Map(this.repository.listBlocks(to.id).map((block) => [block.blockOrder, block]));
    const orders = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b);
    return insightVersionDiffResponseSchema.parse({
      fromVersion,
      toVersion,
      changes: orders.map((order) => {
        const left = before.get(order);
        const right = after.get(order);
        if (!left && right) return { order, kind: right.kind, change: "added" as const, afterContent: parseJson(right.contentJson) };
        if (left && !right) return { order, kind: left.kind, change: "removed" as const, beforeContent: parseJson(left.contentJson) };
        const beforeContent = parseJson(left!.contentJson);
        const afterContent = parseJson(right!.contentJson);
        return {
          order,
          kind: right!.kind,
          change: sameJson(beforeContent, afterContent) ? "unchanged" as const : "modified" as const,
          beforeContent,
          afterContent,
        };
      }),
    });
  }

  public listByBook(bookId: string): InsightListResponse {
    if (!this.bookRepository.findById(bookId)) throw new Error("Book not found");
    const artifacts = this.repository.listByBook(bookId).map((record) => {
      const artifact = this.toArtifact(record);
      return {
        id: artifact.id,
        title: artifact.title,
        kind: artifact.kind,
        primaryBookId: artifact.primaryBookId,
        originTurnIds: artifact.originTurnIds,
        createdBy: artifact.createdBy,
        createdAt: artifact.createdAt,
        updatedAt: artifact.updatedAt,
        version: artifact.version,
        tags: artifact.tags,
        sourceCount: artifact.sourceAnchorIds.length,
      };
    });
    return insightListResponseSchema.parse({ artifacts });
  }

  public getDetail(artifactId: string): InsightArtifactDetail {
    const record = this.repository.findById(artifactId);
    if (!record) throw new Error("Insight artifact not found");
    return insightArtifactDetailSchema.parse({
      artifact: this.toArtifact(record),
      sources: this.repository.listArtifactSources(artifactId),
    });
  }

  private toArtifact(record: InsightArtifactRecord, requestedVersion?: ArtifactVersionRecord): InsightArtifact {
    const version = requestedVersion ?? this.repository.findLatestVersion(record.id);
    if (!version) throw new Error(`Insight artifact has no versions: ${record.id}`);
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

    return insightArtifactSchema.parse({
      id: record.id,
      title: version.title ?? record.title,
      kind: record.kind,
      primaryBookId: record.primaryBookId,
      sourceAnchorIds: this.repository.listArtifactSourceIds(record.id),
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

function deriveTitle(markdown: string): string {
  const heading = markdown.match(/^#{1,6}\s+(.+)$/m)?.[1];
  const bold = markdown.match(/\*\*([^*\n]{3,120})\*\*/)?.[1];
  const firstMeaningfulLine = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const candidate = heading ?? bold ?? firstMeaningfulLine ?? "Deep Dive Insight";
  const cleaned = candidate
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/\[S\d+\]/g, "")
    .replace(/[*_`#]/g, "")
    .trim();
  const sentence = cleaned.split(/[。.!?]/u)[0]?.trim() || "Deep Dive Insight";
  return sentence.slice(0, 80);
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}

function parseTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? normalizeTags(parsed.filter((item): item is string => typeof item === "string")) : [];
  } catch {
    return [];
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { markdown: value };
  }
}
