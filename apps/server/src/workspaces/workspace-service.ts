import { randomUUID } from "node:crypto";
import { readerWorkspaceSchema, readerWorkspaceSummarySchema, type ReaderWorkspace, type ReaderWorkspaceSummary } from "@lensmap/shared";
import type { BookRepository } from "../books/book-repository.js";
import type { SourceAnchorService } from "../sources/source-anchor-service.js";
import { WorkspaceRepository } from "./workspace-repository.js";

/** Own Reader Workspace membership and validate cross-document provenance. */
export class WorkspaceService {
  public constructor(
    private readonly repository: WorkspaceRepository,
    private readonly bookRepository: BookRepository,
    private readonly sourceAnchorService: SourceAnchorService,
  ) {}

  public list(): ReaderWorkspaceSummary[] {
    return this.repository.list().map((workspace) => this.toSummary(workspace.id));
  }

  public get(id: string): ReaderWorkspace { return this.toWorkspace(id); }

  public create(input: { name?: string | undefined; bookId?: string | undefined } = {}): ReaderWorkspace {
    const now = new Date().toISOString();
    const book = input.bookId ? this.bookRepository.findById(input.bookId) : undefined;
    if (input.bookId && !book) throw new Error("Book not found");
    const workspace = this.repository.create({ id: randomUUID(), name: input.name?.trim() || book?.title || "New workspace", createdAt: now, updatedAt: now });
    if (book) this.repository.addBook(workspace.id, book.id);
    return this.toWorkspace(workspace.id);
  }

  public rename(id: string, name: string): ReaderWorkspace {
    if (!this.repository.findById(id)) throw new Error("Workspace not found");
    this.repository.rename(id, name.trim());
    return this.toWorkspace(id);
  }

  public addBook(workspaceId: string, bookId: string): ReaderWorkspace {
    if (!this.repository.findById(workspaceId)) throw new Error("Workspace not found");
    if (!this.bookRepository.findById(bookId)) throw new Error("Book not found");
    this.repository.addBook(workspaceId, bookId);
    return this.toWorkspace(workspaceId);
  }

  public addSource(workspaceId: string, sourceAnchorId: string): ReaderWorkspace {
    if (!this.repository.findById(workspaceId)) throw new Error("Workspace not found");
    const source = this.sourceAnchorService.getById(sourceAnchorId);
    if (!source) throw new Error("SourceAnchor not found");
    if (!this.repository.hasBook(workspaceId, source.bookId)) this.repository.addBook(workspaceId, source.bookId);
    this.repository.addSource(workspaceId, sourceAnchorId);
    return this.toWorkspace(workspaceId);
  }

  public removeSource(workspaceId: string, sourceAnchorId: string): ReaderWorkspace {
    if (!this.repository.findById(workspaceId)) throw new Error("Workspace not found");
    this.repository.removeSource(workspaceId, sourceAnchorId);
    return this.toWorkspace(workspaceId);
  }

  public resolveVisualAssetPath(bookId: string, imageAssetId: string): string {
    return this.sourceAnchorService.resolveVisualAsset(bookId, imageAssetId);
  }

  public containsBook(workspaceId: string, bookId: string): boolean { return this.repository.hasBook(workspaceId, bookId); }
  public listBookIds(workspaceId: string): string[] {
    if (!this.repository.findById(workspaceId)) throw new Error("Workspace not found");
    return this.repository.listBooks(workspaceId).map((book) => book.id);
  }

  public getOrderedSources(workspaceId: string, sourceIds: string[]) {
    if (!this.repository.findById(workspaceId)) throw new Error("Workspace not found");
    const allowed = new Set(this.repository.listSourceRecords(workspaceId).map(({ source }) => source.id));
    return [...new Set(sourceIds)].map((id) => {
      if (!allowed.has(id)) throw new Error(`SourceAnchor is not part of this workspace: ${id}`);
      const source = this.sourceAnchorService.getById(id);
      if (!source) throw new Error(`SourceAnchor not found: ${id}`);
      return source;
    });
  }

  private toSummary(id: string): ReaderWorkspaceSummary {
    const workspace = this.toWorkspace(id);
    return readerWorkspaceSummarySchema.parse({ ...workspace, sourceCount: workspace.sources.length });
  }

  private toWorkspace(id: string): ReaderWorkspace {
    const workspace = this.repository.findById(id);
    if (!workspace) throw new Error("Workspace not found");
    const books = this.repository.listBooks(id).map((book) => ({ id: book.id, title: book.title, fingerprint: book.fingerprint, fileName: book.fileName, pageCount: book.pageCount, createdAt: book.createdAt, updatedAt: book.updatedAt }));
    const sources = this.repository.listSourceRecords(id).map(({ source }) => this.sourceAnchorService.getById(source.id)).filter((source) => source !== undefined);
    return readerWorkspaceSchema.parse({ ...workspace, books, sources });
  }
}
