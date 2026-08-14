import { desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../persistence/database.js";
import { books } from "../persistence/schema.js";

export interface NewBookRecord {
  id: string;
  title: string;
  fingerprint: string;
  fileName: string;
  managedPath: string;
  pageCount: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Encapsulates persistence operations for books so HTTP and PDF logic stay independent of Drizzle. */
export class BookRepository {
  public constructor(private readonly db: AppDatabase) {}

  public list() {
    return this.db.select().from(books).orderBy(desc(books.updatedAt)).all();
  }

  public findById(id: string) {
    return this.db.select().from(books).where(eq(books.id, id)).get();
  }

  public findByFingerprint(fingerprint: string) {
    return this.db.select().from(books).where(eq(books.fingerprint, fingerprint)).get();
  }


  public updateIndexMetadata(id: string, pageCount: number, indexedAt: string | null) {
    this.db.update(books)
      .set({ pageCount, indexedAt, updatedAt: new Date().toISOString() })
      .where(eq(books.id, id))
      .run();
    return this.findById(id);
  }

  public create(record: NewBookRecord) {
    this.db.insert(books).values(record).run();
    return this.findById(record.id);
  }
}
