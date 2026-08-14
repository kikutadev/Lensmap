import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../persistence/database.js";
import { sourceAnchors } from "../persistence/schema.js";

export type SourceAnchorRecord = typeof sourceAnchors.$inferSelect;
export type NewSourceAnchorRecord = typeof sourceAnchors.$inferInsert;

/** Isolate SourceAnchor persistence from HTTP and selection-specific business logic. */
export class SourceAnchorRepository {
  public constructor(private readonly db: AppDatabase) {}

  public create(record: NewSourceAnchorRecord): SourceAnchorRecord {
    this.db.insert(sourceAnchors).values(record).run();
    const created = this.findById(record.id);
    if (!created) {
      throw new Error("SourceAnchor could not be persisted");
    }
    return created;
  }

  public findById(id: string): SourceAnchorRecord | undefined {
    return this.db.select().from(sourceAnchors).where(eq(sourceAnchors.id, id)).get();
  }

  public findByImageAssetId(imageAssetId: string): SourceAnchorRecord | undefined {
    return this.db.select().from(sourceAnchors).where(eq(sourceAnchors.imageAssetId, imageAssetId)).get();
  }

  public findByIds(ids: string[]): SourceAnchorRecord[] {
    if (ids.length === 0) return [];
    return this.db.select().from(sourceAnchors).where(inArray(sourceAnchors.id, ids)).all();
  }


  public findAiExpansion(bookId: string, pageStart: number, textHash: string): SourceAnchorRecord | undefined {
    return this.db
      .select()
      .from(sourceAnchors)
      .where(and(
        eq(sourceAnchors.bookId, bookId),
        eq(sourceAnchors.kind, "text"),
        eq(sourceAnchors.pageStart, pageStart),
        eq(sourceAnchors.textHash, textHash),
        eq(sourceAnchors.origin, "ai-expansion"),
      ))
      .get();
  }

  public listByBook(bookId: string): SourceAnchorRecord[] {
    return this.db
      .select()
      .from(sourceAnchors)
      .where(eq(sourceAnchors.bookId, bookId))
      .orderBy(asc(sourceAnchors.createdAt))
      .all();
  }
}
