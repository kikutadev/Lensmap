import { asc, desc, eq } from "drizzle-orm";
import type { MapSemanticKind } from "@lensmap/shared";
import type { AppDatabase } from "../persistence/database.js";
import {
  books,
  mapArtifacts,
  mapBlockSources,
  mapBlocks,
  mapOriginTurns,
  mapSources,
  mapVersions,
  sourceAnchors,
} from "../persistence/schema.js";

type AppTransaction = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];

export type MapArtifactRecord = typeof mapArtifacts.$inferSelect;
export type MapVersionRecord = typeof mapVersions.$inferSelect;
export type MapBlockRecord = typeof mapBlocks.$inferSelect;

export interface NewMapBlock {
  id: string;
  kind: "definition" | "narrative" | "callout" | "table" | "diagram" | "chart" | "visual-reference";
  blockOrder: number;
  contentJson: string;
  groundingKind: "source-backed" | "derived" | "ai-explanation";
  groundingStatus: "references-checked" | "claim-verified" | "modified" | "needs-review";
  sourceRefs: Array<{ label: string; sourceAnchorId: string }>;
}

export interface CreateMapRecord {
  id: string;
  workspaceId: string;
  title: string;
  preview: string;
  conciseExplanation: string;
  createdBy: "ai" | "user" | "mixed";
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  versionId: string;
  semanticKind: MapSemanticKind;
  primaryBlockId: string | null;
  sourceAnchorIds: string[];
  originTurnIds: string[];
  blocks: NewMapBlock[];
}

export interface CreateMapVersionRecord {
  mapArtifactId: string;
  title: string;
  conciseExplanation: string;
  createdAt: string;
  versionId: string;
  version: number;
  tags?: string[];
  preview?: string;
  semanticKind: MapSemanticKind;
  primaryBlockId: string | null;
  blocks: NewMapBlock[];
}

/** Persist canonical MapArtifact / MapVersion / MapBlock records and immutable evidence links. */
export class MapRepository {
  public constructor(private readonly db: AppDatabase) {}

  public create(record: CreateMapRecord): MapArtifactRecord {
    this.db.transaction((tx) => {
      tx.insert(mapArtifacts).values({
        id: record.id,
        workspaceId: record.workspaceId,
        title: record.title,
        preview: record.preview,
        createdBy: record.createdBy,
        tagsJson: JSON.stringify(record.tags ?? []),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }).run();
      tx.insert(mapVersions).values({
        id: record.versionId,
        mapArtifactId: record.id,
        version: 1,
        title: record.title,
        conciseExplanation: record.conciseExplanation,
        semanticKind: record.semanticKind,
        primaryBlockId: record.primaryBlockId,
        createdAt: record.createdAt,
      }).run();
      if (record.sourceAnchorIds.length > 0) {
        tx.insert(mapSources).values(record.sourceAnchorIds.map((sourceAnchorId) => ({
          mapArtifactId: record.id,
          sourceAnchorId,
        }))).run();
      }
      if (record.originTurnIds.length > 0) {
        tx.insert(mapOriginTurns).values(record.originTurnIds.map((codexTurnId) => ({
          mapArtifactId: record.id,
          codexTurnId,
        }))).run();
      }
      this.insertBlocks(tx, record.versionId, record.blocks);
    });
    const created = this.findById(record.id);
    if (!created) throw new Error("MapArtifact could not be persisted");
    return created;
  }

  public createVersion(record: CreateMapVersionRecord): MapVersionRecord {
    this.db.transaction((tx) => {
      tx.update(mapArtifacts).set({
        title: record.title,
        createdBy: "mixed",
        ...(record.preview !== undefined ? { preview: record.preview } : {}),
        ...(record.tags ? { tagsJson: JSON.stringify(record.tags) } : {}),
        updatedAt: record.createdAt,
      }).where(eq(mapArtifacts.id, record.mapArtifactId)).run();
      tx.insert(mapVersions).values({
        id: record.versionId,
        mapArtifactId: record.mapArtifactId,
        version: record.version,
        title: record.title,
        conciseExplanation: record.conciseExplanation,
        semanticKind: record.semanticKind,
        primaryBlockId: record.primaryBlockId,
        createdAt: record.createdAt,
      }).run();
      this.insertBlocks(tx, record.versionId, record.blocks);
    });
    const created = this.findVersion(record.mapArtifactId, record.version);
    if (!created) throw new Error("MapVersion could not be persisted");
    return created;
  }

  private insertBlocks(tx: AppTransaction, versionId: string, blocks: NewMapBlock[]): void {
    if (blocks.length === 0) return;
    tx.insert(mapBlocks).values(blocks.map((block) => ({
      id: block.id,
      versionId,
      kind: block.kind,
      blockOrder: block.blockOrder,
      contentJson: block.contentJson,
      groundingKind: block.groundingKind,
      groundingStatus: block.groundingStatus,
    }))).run();
    const sourceRows = blocks.flatMap((block) => block.sourceRefs.map((sourceRef) => ({
      blockId: block.id,
      sourceAnchorId: sourceRef.sourceAnchorId,
      sourceLabel: sourceRef.label,
    })));
    if (sourceRows.length > 0) tx.insert(mapBlockSources).values(sourceRows).run();
  }

  public listVersions(mapArtifactId: string): MapVersionRecord[] {
    return this.db.select().from(mapVersions).where(eq(mapVersions.mapArtifactId, mapArtifactId)).orderBy(desc(mapVersions.version)).all();
  }
  public findVersion(mapArtifactId: string, version: number): MapVersionRecord | undefined {
    return this.db.select().from(mapVersions).where(eq(mapVersions.mapArtifactId, mapArtifactId)).all().find((candidate) => candidate.version === version);
  }
  public findById(id: string): MapArtifactRecord | undefined { return this.db.select().from(mapArtifacts).where(eq(mapArtifacts.id, id)).get(); }
  public listByWorkspace(workspaceId: string): MapArtifactRecord[] {
    return this.db.select().from(mapArtifacts).where(eq(mapArtifacts.workspaceId, workspaceId)).orderBy(desc(mapArtifacts.updatedAt)).all();
  }
  public findLatestVersion(mapArtifactId: string): MapVersionRecord | undefined {
    return this.db.select().from(mapVersions).where(eq(mapVersions.mapArtifactId, mapArtifactId)).orderBy(desc(mapVersions.version)).limit(1).get();
  }
  public listBlocks(versionId: string): MapBlockRecord[] {
    return this.db.select().from(mapBlocks).where(eq(mapBlocks.versionId, versionId)).orderBy(asc(mapBlocks.blockOrder)).all();
  }
  public listMapSourceIds(mapArtifactId: string): string[] {
    return this.db.select({ sourceAnchorId: mapSources.sourceAnchorId }).from(mapSources).where(eq(mapSources.mapArtifactId, mapArtifactId)).all().map((row) => row.sourceAnchorId);
  }
  public listBlockSourceRefs(blockId: string): Array<{ label: string; sourceAnchorId: string }> {
    return this.db.select({ label: mapBlockSources.sourceLabel, sourceAnchorId: mapBlockSources.sourceAnchorId })
      .from(mapBlockSources).where(eq(mapBlockSources.blockId, blockId)).orderBy(asc(mapBlockSources.sourceLabel)).all();
  }
  public findMapIdByOriginTurnId(codexTurnId: string): string | null {
    return this.db.select({ mapArtifactId: mapOriginTurns.mapArtifactId }).from(mapOriginTurns)
      .where(eq(mapOriginTurns.codexTurnId, codexTurnId)).limit(1).get()?.mapArtifactId ?? null;
  }
  public listOriginTurnIds(mapArtifactId: string): string[] {
    return this.db.select({ codexTurnId: mapOriginTurns.codexTurnId }).from(mapOriginTurns)
      .where(eq(mapOriginTurns.mapArtifactId, mapArtifactId)).all().map((row) => row.codexTurnId);
  }
  public listMapSources(mapArtifactId: string) {
    return this.db.select({
      sourceAnchorId: sourceAnchors.id,
      bookId: sourceAnchors.bookId,
      bookTitle: books.title,
      kind: sourceAnchors.kind,
      imageAssetId: sourceAnchors.imageAssetId,
      locationStatus: sourceAnchors.locationStatus,
      visualPage: sourceAnchors.visualPage,
      recognizedText: sourceAnchors.recognizedText,
      pageStart: sourceAnchors.pageStart,
      pageEnd: sourceAnchors.pageEnd,
      printedPageLabelStart: sourceAnchors.printedPageLabelStart,
      printedPageLabelEnd: sourceAnchors.printedPageLabelEnd,
      quoteRaw: sourceAnchors.quoteRaw,
      origin: sourceAnchors.origin,
    }).from(mapSources)
      .innerJoin(sourceAnchors, eq(mapSources.sourceAnchorId, sourceAnchors.id))
      .innerJoin(books, eq(sourceAnchors.bookId, books.id))
      .where(eq(mapSources.mapArtifactId, mapArtifactId))
      .orderBy(asc(sourceAnchors.bookId), asc(sourceAnchors.pageStart)).all();
  }
}
