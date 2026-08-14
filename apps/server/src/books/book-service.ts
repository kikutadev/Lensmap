import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { once } from "node:events";
import type { MultipartFile } from "@fastify/multipart";
import type { AppConfig } from "../config.js";
import { BookRepository } from "./book-repository.js";

export interface ImportedBook {
  id: string;
  title: string;
  fingerprint: string;
  fileName: string;
  pageCount: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Handles managed PDF storage and duplicate detection independently from HTTP transport. */
export class BookService {
  public constructor(
    private readonly repository: BookRepository,
    private readonly config: AppConfig,
  ) {}

  public list(): ImportedBook[] {
    return this.repository.list().map(toPublicBook);
  }

  public find(id: string): ImportedBook | undefined {
    const book = this.repository.findById(id);
    return book ? toPublicBook(book) : undefined;
  }

  public getPdfPath(id: string): string | undefined {
    return this.repository.findById(id)?.managedPath;
  }

  public async importPdf(part: MultipartFile): Promise<ImportedBook> {
    if (part.mimetype !== "application/pdf" && !part.filename.toLowerCase().endsWith(".pdf")) {
      throw new Error("Only PDF files can be imported");
    }

    const importsDir = join(this.config.dataDir, "imports");
    mkdirSync(importsDir, { recursive: true });
    const tempPath = join(importsDir, `${randomUUID()}.pdf.part`);
    const hash = createHash("sha256");
    const writer = createWriteStream(tempPath, { flags: "wx" });

    try {
      for await (const chunk of part.file) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(buffer);
        if (!writer.write(buffer)) {
          await once(writer, "drain");
        }
      }
      writer.end();
      await once(writer, "finish");

      if (part.file.truncated) {
        throw new Error("Uploaded PDF exceeded the configured size limit");
      }

      const fingerprint = hash.digest("hex");
      const existing = this.repository.findByFingerprint(fingerprint);
      if (existing) {
        rmSync(tempPath, { force: true });
        return toPublicBook(existing);
      }

      const id = randomUUID();
      const managedPath = join(this.config.dataDir, "books", id, "source.pdf");
      mkdirSync(dirname(managedPath), { recursive: true });
      renameSync(tempPath, managedPath);

      const now = new Date().toISOString();
      const title = basename(part.filename, ".pdf") || "Untitled PDF";
      const created = this.repository.create({
        id,
        title,
        fingerprint,
        fileName: part.filename,
        managedPath,
        pageCount: null,
        createdAt: now,
        updatedAt: now,
      });

      if (!created) {
        throw new Error("Imported book could not be persisted");
      }
      return toPublicBook(created);
    } catch (error: unknown) {
      writer.destroy();
      rmSync(tempPath, { force: true });
      throw error;
    }
  }

  public openPdf(id: string) {
    const path = this.getPdfPath(id);
    return path ? createReadStream(path) : undefined;
  }
}

function toPublicBook(book: ReturnType<BookRepository["findById"]> extends infer T ? Exclude<T, undefined> : never): ImportedBook {
  return {
    id: book.id,
    title: book.title,
    fingerprint: book.fingerprint,
    fileName: book.fileName,
    pageCount: book.pageCount,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  };
}
