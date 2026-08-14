import { and, asc, desc, eq, max } from "drizzle-orm";
import type { AppDatabase } from "../persistence/database.js";
import { books, readerWorkspaces, sourceAnchors, workspaceBooks, workspaceSources } from "../persistence/schema.js";

export type WorkspaceRecord = typeof readerWorkspaces.$inferSelect;

/** Persist Reader Workspace membership independently from browser-tab state. */
export class WorkspaceRepository {
  public constructor(private readonly db: AppDatabase) {}

  public list(): WorkspaceRecord[] {
    return this.db.select().from(readerWorkspaces).orderBy(desc(readerWorkspaces.updatedAt)).all();
  }

  public findById(id: string): WorkspaceRecord | undefined {
    return this.db.select().from(readerWorkspaces).where(eq(readerWorkspaces.id, id)).get();
  }

  public create(record: typeof readerWorkspaces.$inferInsert): WorkspaceRecord {
    this.db.insert(readerWorkspaces).values(record).run();
    const created = this.findById(record.id);
    if (!created) throw new Error("Workspace could not be persisted");
    return created;
  }

  public rename(id: string, name: string): WorkspaceRecord {
    this.db.update(readerWorkspaces).set({ name, updatedAt: new Date().toISOString() }).where(eq(readerWorkspaces.id, id)).run();
    const updated = this.findById(id);
    if (!updated) throw new Error("Workspace not found");
    return updated;
  }

  public addBook(workspaceId: string, bookId: string): void {
    this.db.insert(workspaceBooks).values({ workspaceId, bookId, createdAt: new Date().toISOString() }).onConflictDoNothing().run();
    this.touch(workspaceId);
  }

  public listBooks(workspaceId: string) {
    return this.db.select({ book: books }).from(workspaceBooks)
      .innerJoin(books, eq(workspaceBooks.bookId, books.id))
      .where(eq(workspaceBooks.workspaceId, workspaceId))
      .orderBy(asc(workspaceBooks.createdAt)).all().map((row) => row.book);
  }

  public hasBook(workspaceId: string, bookId: string): boolean {
    return Boolean(this.db.select({ bookId: workspaceBooks.bookId }).from(workspaceBooks)
      .where(and(eq(workspaceBooks.workspaceId, workspaceId), eq(workspaceBooks.bookId, bookId))).get());
  }

  public addSource(workspaceId: string, sourceAnchorId: string): void {
    const current = this.db.select({ value: max(workspaceSources.sourceOrder) }).from(workspaceSources)
      .where(eq(workspaceSources.workspaceId, workspaceId)).get()?.value ?? -1;
    this.db.insert(workspaceSources).values({
      workspaceId,
      sourceAnchorId,
      sourceOrder: Number(current) + 1,
      createdAt: new Date().toISOString(),
    }).onConflictDoNothing().run();
    this.touch(workspaceId);
  }

  public removeSource(workspaceId: string, sourceAnchorId: string): void {
    this.db.delete(workspaceSources)
      .where(and(eq(workspaceSources.workspaceId, workspaceId), eq(workspaceSources.sourceAnchorId, sourceAnchorId))).run();
    this.touch(workspaceId);
  }

  public listSourceRecords(workspaceId: string) {
    return this.db.select({ source: sourceAnchors, sourceOrder: workspaceSources.sourceOrder })
      .from(workspaceSources)
      .innerJoin(sourceAnchors, eq(workspaceSources.sourceAnchorId, sourceAnchors.id))
      .where(eq(workspaceSources.workspaceId, workspaceId))
      .orderBy(asc(workspaceSources.sourceOrder)).all();
  }

  private touch(id: string): void {
    this.db.update(readerWorkspaces).set({ updatedAt: new Date().toISOString() }).where(eq(readerWorkspaces.id, id)).run();
  }
}
