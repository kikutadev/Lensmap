import { asc, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../persistence/database.js";
import {
  artifactBlockSources,
  artifactBlocks,
  artifactOriginTurns,
  artifactSources,
  artifactVersions,
  insightArtifacts,
  sourceAnchors,
} from "../persistence/schema.js";

export type InsightArtifactRecord = typeof insightArtifacts.$inferSelect;
export type ArtifactVersionRecord = typeof artifactVersions.$inferSelect;
export type ArtifactBlockRecord = typeof artifactBlocks.$inferSelect;

export interface NewInsightBlock {
  id: string;
  kind: "markdown" | "table" | "diagram" | "chart";
  blockOrder: number;
  contentJson: string;
  groundingKind: "source-backed" | "derived" | "ai-explanation";
  groundingStatus: "references-checked" | "claim-verified" | "modified" | "needs-review";
  sourceAnchorIds: string[];
  sourceRefs: Array<{ label: string; sourceAnchorId: string }>;
}

export interface CreateInsightRecord {
  id: string;
  title: string;
  kind: "note" | "report" | "table" | "diagram" | "chart";
  primaryBookId: string | null;
  createdBy: "ai" | "user" | "mixed";
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  versionId: string;
  sourceAnchorIds: string[];
  originTurnIds: string[];
  blocks: NewInsightBlock[];
}

export interface CreateInsightVersionRecord {
  artifactId: string;
  title: string;
  createdAt: string;
  versionId: string;
  version: number;
  tags?: string[];
  blocks: NewInsightBlock[];
}

/** Persist versioned Insight artifacts and their immutable provenance links. */
export class InsightRepository {
  public constructor(private readonly db: AppDatabase) {}

  public create(record: CreateInsightRecord): InsightArtifactRecord {
    this.db.transaction((tx) => {
      tx.insert(insightArtifacts).values({
        id: record.id,
        title: record.title,
        kind: record.kind,
        primaryBookId: record.primaryBookId,
        createdBy: record.createdBy,
        tagsJson: JSON.stringify(record.tags ?? []),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }).run();
      tx.insert(artifactVersions).values({
        id: record.versionId,
        artifactId: record.id,
        version: 1,
        title: record.title,
        createdAt: record.createdAt,
      }).run();
      if (record.sourceAnchorIds.length > 0) {
        tx.insert(artifactSources).values(record.sourceAnchorIds.map((sourceAnchorId) => ({
          artifactId: record.id,
          sourceAnchorId,
        }))).run();
      }
      if (record.originTurnIds.length > 0) {
        tx.insert(artifactOriginTurns).values(record.originTurnIds.map((codexTurnId) => ({
          artifactId: record.id,
          codexTurnId,
        }))).run();
      }
      if (record.blocks.length > 0) {
        tx.insert(artifactBlocks).values(record.blocks.map((block) => ({
          id: block.id,
          versionId: record.versionId,
          kind: block.kind,
          blockOrder: block.blockOrder,
          contentJson: block.contentJson,
          groundingKind: block.groundingKind,
          groundingStatus: block.groundingStatus,
        }))).run();
        const blockSourceRows = record.blocks.flatMap((block) => block.sourceRefs.map((sourceRef) => ({
          blockId: block.id,
          sourceAnchorId: sourceRef.sourceAnchorId,
          sourceLabel: sourceRef.label,
        })));
        if (blockSourceRows.length > 0) {
          tx.insert(artifactBlockSources).values(blockSourceRows).run();
        }
      }
    });

    const created = this.findById(record.id);
    if (!created) throw new Error("Insight artifact could not be persisted");
    return created;
  }

  /** Append an immutable version while keeping artifact-level provenance stable. */
  public createVersion(record: CreateInsightVersionRecord): ArtifactVersionRecord {
    this.db.transaction((tx) => {
      tx.update(insightArtifacts).set({
        title: record.title,
        createdBy: "mixed",
        ...(record.tags ? { tagsJson: JSON.stringify(record.tags) } : {}),
        updatedAt: record.createdAt,
      }).where(eq(insightArtifacts.id, record.artifactId)).run();
      tx.insert(artifactVersions).values({
        id: record.versionId,
        artifactId: record.artifactId,
        version: record.version,
        title: record.title,
        createdAt: record.createdAt,
      }).run();
      if (record.blocks.length > 0) {
        tx.insert(artifactBlocks).values(record.blocks.map((block) => ({
          id: block.id,
          versionId: record.versionId,
          kind: block.kind,
          blockOrder: block.blockOrder,
          contentJson: block.contentJson,
          groundingKind: block.groundingKind,
          groundingStatus: block.groundingStatus,
        }))).run();
        const sourceRows = record.blocks.flatMap((block) => block.sourceRefs.map((sourceRef) => ({
          blockId: block.id,
          sourceAnchorId: sourceRef.sourceAnchorId,
          sourceLabel: sourceRef.label,
        })));
        if (sourceRows.length > 0) tx.insert(artifactBlockSources).values(sourceRows).run();
      }
    });
    const created = this.findVersion(record.artifactId, record.version);
    if (!created) throw new Error("Insight version could not be persisted");
    return created;
  }

  public listVersions(artifactId: string): ArtifactVersionRecord[] {
    return this.db.select().from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifactId))
      .orderBy(desc(artifactVersions.version)).all();
  }

  public findVersion(artifactId: string, version: number): ArtifactVersionRecord | undefined {
    return this.db.select().from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifactId))
      .all().find((candidate) => candidate.version === version);
  }

  public findById(id: string): InsightArtifactRecord | undefined {
    return this.db.select().from(insightArtifacts).where(eq(insightArtifacts.id, id)).get();
  }

  public listByBook(bookId: string): InsightArtifactRecord[] {
    return this.db
      .select()
      .from(insightArtifacts)
      .where(eq(insightArtifacts.primaryBookId, bookId))
      .orderBy(desc(insightArtifacts.updatedAt))
      .all();
  }

  public findLatestVersion(artifactId: string): ArtifactVersionRecord | undefined {
    return this.db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifactId))
      .orderBy(desc(artifactVersions.version))
      .limit(1)
      .get();
  }

  public listBlocks(versionId: string): ArtifactBlockRecord[] {
    return this.db
      .select()
      .from(artifactBlocks)
      .where(eq(artifactBlocks.versionId, versionId))
      .orderBy(asc(artifactBlocks.blockOrder))
      .all();
  }

  public listArtifactSourceIds(artifactId: string): string[] {
    return this.db
      .select({ sourceAnchorId: artifactSources.sourceAnchorId })
      .from(artifactSources)
      .where(eq(artifactSources.artifactId, artifactId))
      .all()
      .map((row) => row.sourceAnchorId);
  }

  public listBlockSourceRefs(blockId: string): Array<{ label: string; sourceAnchorId: string }> {
    return this.db
      .select({
        label: artifactBlockSources.sourceLabel,
        sourceAnchorId: artifactBlockSources.sourceAnchorId,
      })
      .from(artifactBlockSources)
      .where(eq(artifactBlockSources.blockId, blockId))
      .orderBy(asc(artifactBlockSources.sourceLabel))
      .all();
  }

  public listOriginTurnIds(artifactId: string): string[] {
    return this.db
      .select({ codexTurnId: artifactOriginTurns.codexTurnId })
      .from(artifactOriginTurns)
      .where(eq(artifactOriginTurns.artifactId, artifactId))
      .all()
      .map((row) => row.codexTurnId);
  }

  public listArtifactSources(artifactId: string) {
    return this.db
      .select({
        sourceAnchorId: sourceAnchors.id,
        bookId: sourceAnchors.bookId,
        pageStart: sourceAnchors.pageStart,
        pageEnd: sourceAnchors.pageEnd,
        printedPageLabelStart: sourceAnchors.printedPageLabelStart,
        printedPageLabelEnd: sourceAnchors.printedPageLabelEnd,
        quoteRaw: sourceAnchors.quoteRaw,
        origin: sourceAnchors.origin,
      })
      .from(artifactSources)
      .innerJoin(sourceAnchors, eq(artifactSources.sourceAnchorId, sourceAnchors.id))
      .where(eq(artifactSources.artifactId, artifactId))
      .orderBy(asc(sourceAnchors.bookId), asc(sourceAnchors.pageStart))
      .all();
  }
}
