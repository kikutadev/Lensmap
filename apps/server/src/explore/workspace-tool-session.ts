import { z } from "zod";
import { mapDraftSchema, type MapDraft, type SourceAnchor, type TextSourceAnchor } from "@lensmap/shared";
import type { DynamicToolCallParams } from "../codex/protocol.js";
import type { ReaderDynamicToolResult, ReaderDynamicToolSpec } from "../codex/app-server-client.js";
import type { BookContextGateway, MaterializedBookSource } from "../documents/book-context-gateway.js";

interface WorkspaceToolLimits {
  maxToolCalls: number;
  maxMaterializedSources: number;
  maxRetrievedCharacters: number;
}

const DEFAULT_LIMITS: WorkspaceToolLimits = {
  maxToolCalls: 12,
  maxMaterializedSources: 16,
  maxRetrievedCharacters: 24_000,
};

const expandInputSchema = z.object({
  sourceLabel: z.string().regex(/^S\d+$/),
  before: z.number().int().default(1).transform((value) => Math.min(Math.max(value, 0), 4)),
  after: z.number().int().default(1).transform((value) => Math.min(Math.max(value, 0), 4)),
});
const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(1_000),
  bookIds: z.array(z.string().min(1)).max(16).optional(),
  limit: z.number().int().default(8).transform((value) => Math.min(Math.max(value, 1), 16)),
});
const readBlocksInputSchema = z.object({
  blocks: z.array(z.object({ bookId: z.string().min(1), blockId: z.string().min(1) })).min(1).max(16),
});
const listSectionsInputSchema = z.object({
  bookId: z.string().min(1),
  query: z.string().trim().max(500).optional(),
});
const readSectionInputSchema = z.object({
  bookId: z.string().min(1),
  sectionId: z.string().min(1),
  maxBlocks: z.number().int().default(8).transform((value) => Math.min(Math.max(value, 1), 12)),
});

export interface WorkspaceToolSourceLink {
  sourceAnchorId: string;
  sourceLabel: string;
  sourceOrder: number;
  includedText: string;
  truncated: boolean;
}

export interface WorkspaceToolAuditEvent {
  toolName: string;
  arguments: unknown;
  resultSummary: unknown;
  createdAt: string;
}

export interface WorkspaceToolSessionOptions {
  workspaceId: string;
  books: Array<{ id: string; title: string }>;
  explicitSources: Array<{ label: string; source: SourceAnchor }>;
  gateway: BookContextGateway;
  limits?: Partial<WorkspaceToolLimits>;
}

/** Per-turn, read-only retrieval over every book attached to the active Reader Workspace. */
export class WorkspaceToolSession {
  public readonly specs: ReaderDynamicToolSpec[] = WORKSPACE_TOOL_SPECS;
  private readonly workspaceId: string;
  private readonly gateway: BookContextGateway;
  private readonly limits: WorkspaceToolLimits;
  private readonly books = new Map<string, string>();
  private readonly labelToSource = new Map<string, SourceAnchor>();
  private readonly sourceIdToLabel = new Map<string, string>();
  private readonly materialized = new Map<string, WorkspaceToolSourceLink>();
  private readonly auditEvents: WorkspaceToolAuditEvent[] = [];
  private nextSourceNumber: number;
  private toolCalls = 0;
  private retrievedCharacters = 0;
  private mapDraft: MapDraft | null = null;

  public constructor(options: WorkspaceToolSessionOptions) {
    this.workspaceId = options.workspaceId;
    this.gateway = options.gateway;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    for (const book of options.books) this.books.set(book.id, book.title);
    let maxSourceNumber = 0;
    for (const explicit of options.explicitSources) {
      this.assertBook(explicit.source.bookId);
      this.labelToSource.set(explicit.label, explicit.source);
      this.sourceIdToLabel.set(explicit.source.id, explicit.label);
      const number = Number(explicit.label.slice(1));
      if (Number.isFinite(number)) maxSourceNumber = Math.max(maxSourceNumber, number);
    }
    this.nextSourceNumber = maxSourceNumber + 1;
  }

  public getSourceLinks(): WorkspaceToolSourceLink[] {
    return [...this.materialized.values()].sort((left, right) => left.sourceOrder - right.sourceOrder);
  }

  public getAuditEvents(): WorkspaceToolAuditEvent[] { return [...this.auditEvents]; }

  public getMapDraft(): MapDraft | null { return this.mapDraft; }

  public async handle(request: DynamicToolCallParams): Promise<ReaderDynamicToolResult> {
    if (request.namespace !== null && request.namespace !== "") return failure(`Unsupported tool namespace: ${request.namespace}`);
    if (request.tool === "lensmap_compose_map") return this.handleComposeMap(request.arguments);
    if (this.toolCalls >= this.limits.maxToolCalls) return failure("Workspace expansion budget exhausted: too many tool calls.");
    this.toolCalls += 1;
    try {
      switch (request.tool) {
        case "workspace_expand_source": return await this.handleExpand(request.arguments);
        case "workspace_search": return await this.handleSearch(request.arguments);
        case "workspace_read_blocks": return await this.handleReadBlocks(request.arguments);
        case "workspace_list_sections": return await this.handleListSections(request.arguments);
        case "workspace_read_section": return await this.handleReadSection(request.arguments);
        default: return failure(`Unknown Lensmap workspace tool: ${request.tool}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Workspace retrieval failed";
      this.recordAudit(request.tool, request.arguments, { success: false, error: message });
      return failure(message);
    }
  }

  private handleComposeMap(argumentsValue: unknown): ReaderDynamicToolResult {
    if (this.mapDraft) return failure("Map Draft was already submitted for this turn.");
    const draft = mapDraftSchema.parse(argumentsValue);
    const labels = new Set([
      ...draft.sourceRefs,
      ...draft.primary.sourceRefs,
      ...draft.supportingBlocks.flatMap((block) => block.sourceRefs),
    ]);
    const invalid = [...labels].filter((label) => !this.labelToSource.has(label));
    if (invalid.length > 0) {
      this.recordAudit("lensmap_compose_map", argumentsValue, { success: false, invalidSourceLabels: invalid });
      return failure(`Map Draft contains unknown source labels: ${invalid.join(", ")}`);
    }
    this.mapDraft = draft;
    this.recordAudit("lensmap_compose_map", { semanticKind: draft.semanticKind, title: draft.title }, {
      success: true, primaryType: draft.primary.type, supportingBlockCount: draft.supportingBlocks.length,
    });
    return success("Map Draft accepted. Continue with the concise user-facing answer; do not print the draft JSON.");
  }

  private async handleSearch(argumentsValue: unknown): Promise<ReaderDynamicToolResult> {
    const input = searchInputSchema.parse(argumentsValue);
    const targetIds = input.bookIds?.length ? [...new Set(input.bookIds)] : [...this.books.keys()];
    targetIds.forEach((id) => this.assertBook(id));
    const perBookLimit = Math.max(2, Math.ceil(input.limit / Math.max(1, targetIds.length)));
    const results = await Promise.all(targetIds.map(async (bookId) => ({
      bookId,
      result: await this.gateway.searchBook(bookId, input.query, Math.min(input.limit, perBookLimit)),
    })));
    const candidates = results.flatMap(({ bookId, result }) => result.hits.map((hit) => ({
      bookId,
      bookTitle: this.books.get(bookId),
      blockId: hit.block.id,
      pdfPage: hit.block.pageIndex + 1,
      kind: hit.block.kind,
      snippet: hit.snippet,
    }))).slice(0, input.limit);
    this.recordAudit("workspace_search", { ...input, bookIds: targetIds }, { candidateCount: candidates.length, candidates });
    return success([
      "Search candidates only; they are NOT citation sources until workspace_read_blocks reads them.",
      JSON.stringify({ workspaceId: this.workspaceId, query: input.query, candidates }, null, 2),
    ].join("\n"));
  }

  private async handleReadBlocks(argumentsValue: unknown): Promise<ReaderDynamicToolResult> {
    const input = readBlocksInputSchema.parse(argumentsValue);
    const grouped = new Map<string, string[]>();
    for (const item of input.blocks) {
      this.assertBook(item.bookId);
      grouped.set(item.bookId, [...(grouped.get(item.bookId) ?? []), item.blockId]);
    }
    const sources = (await Promise.all([...grouped.entries()].map(([bookId, blockIds]) => this.gateway.readBlocks(bookId, blockIds)))).flat();
    const rendered = this.registerMaterializedSources(sources);
    this.recordAudit("workspace_read_blocks", input, {
      sourceLabels: rendered.map((item) => item.label),
      blocks: rendered.map((item) => ({ bookId: item.source.bookId, blockId: item.blockId })),
    });
    return success(rendered.length ? rendered.map((item) => this.renderToolSource(item)).join("\n\n") : "No additional source could be read within the expansion budget.");
  }

  private async handleListSections(argumentsValue: unknown): Promise<ReaderDynamicToolResult> {
    const input = listSectionsInputSchema.parse(argumentsValue);
    this.assertBook(input.bookId);
    const sections = await this.gateway.listSections(input.bookId, input.query);
    const summary = sections.map((section) => ({
      bookId: input.bookId,
      bookTitle: this.books.get(input.bookId),
      sectionId: section.id,
      title: section.title,
      pdfPage: section.pageIndex + 1,
      depth: section.depth,
    }));
    this.recordAudit("workspace_list_sections", input, { sectionCount: summary.length, sections: summary });
    return success(["Section candidates only. Use workspace_read_section to read citeable text.", JSON.stringify(summary, null, 2)].join("\n"));
  }

  private async handleReadSection(argumentsValue: unknown): Promise<ReaderDynamicToolResult> {
    const input = readSectionInputSchema.parse(argumentsValue);
    this.assertBook(input.bookId);
    const rendered = this.registerMaterializedSources(await this.gateway.readSection(input.bookId, input.sectionId, input.maxBlocks));
    this.recordAudit("workspace_read_section", input, {
      sourceLabels: rendered.map((item) => item.label),
      blocks: rendered.map((item) => ({ bookId: item.source.bookId, blockId: item.blockId })),
    });
    return success(rendered.length ? rendered.map((item) => this.renderToolSource(item)).join("\n\n") : "No section text could be read within the expansion budget.");
  }

  private async handleExpand(argumentsValue: unknown): Promise<ReaderDynamicToolResult> {
    const input = expandInputSchema.parse(argumentsValue);
    const source = this.labelToSource.get(input.sourceLabel);
    if (!source) return failure(`Unknown source label: ${input.sourceLabel}`);
    this.assertBook(source.bookId);
    const rendered = this.registerMaterializedSources(await this.gateway.expandSource(source.bookId, source.id, input.before, input.after));
    this.recordAudit("workspace_expand_source", input, {
      sourceLabels: rendered.map((item) => item.label),
      blocks: rendered.map((item) => ({ bookId: item.source.bookId, blockId: item.blockId })),
    });
    return success(rendered.length ? rendered.map((item) => this.renderToolSource(item)).join("\n\n") : `No additional nearby context was available for ${input.sourceLabel}.`);
  }

  private registerMaterializedSources(sources: MaterializedBookSource[]): RegisteredToolSource[] {
    const result: RegisteredToolSource[] = [];
    for (const candidate of sources) {
      this.assertBook(candidate.source.bookId);
      const existingLabel = this.sourceIdToLabel.get(candidate.source.id);
      if (existingLabel) {
        const existing = this.materialized.get(candidate.source.id);
        if (existing) result.push({ label: existingLabel, blockId: candidate.blockId, source: candidate.source, includedText: existing.includedText, truncated: existing.truncated });
        continue;
      }
      if (this.materialized.size >= this.limits.maxMaterializedSources || this.retrievedCharacters >= this.limits.maxRetrievedCharacters) break;
      const remaining = this.limits.maxRetrievedCharacters - this.retrievedCharacters;
      const fullText = candidate.source.quoteNormalized;
      const includedText = fullText.length <= remaining ? fullText : truncateAtBoundary(fullText, remaining);
      if (!includedText) break;
      const truncated = includedText.length < fullText.length;
      const label = `S${this.nextSourceNumber++}`;
      const link: WorkspaceToolSourceLink = {
        sourceAnchorId: candidate.source.id,
        sourceLabel: label,
        sourceOrder: Number(label.slice(1)) - 1,
        includedText,
        truncated,
      };
      this.materialized.set(candidate.source.id, link);
      this.labelToSource.set(label, candidate.source);
      this.sourceIdToLabel.set(candidate.source.id, label);
      this.retrievedCharacters += includedText.length;
      result.push({ label, blockId: candidate.blockId, source: candidate.source, includedText, truncated });
    }
    return result;
  }

  private assertBook(bookId: string): void {
    if (!this.books.has(bookId)) throw new Error(`Book is not part of this workspace: ${bookId}`);
  }

  private renderToolSource(item: RegisteredToolSource): string {
    const printed = item.source.printedPageLabelStart?.trim();
    const page = printed ? `printed p.${printed} / PDF p.${item.source.pageStart + 1}` : `PDF p.${item.source.pageStart + 1}`;
    return [
      `${item.label} | ${this.books.get(item.source.bookId) ?? item.source.bookId} | ${page} | ai-expansion | block ${item.blockId}${item.truncated ? " | truncated" : ""}`,
      item.includedText,
      `When relying on this text, cite [${item.label}].`,
    ].join("\n");
  }

  private recordAudit(toolName: string, args: unknown, resultSummary: unknown): void {
    this.auditEvents.push({ toolName, arguments: args, resultSummary, createdAt: new Date().toISOString() });
  }
}

interface RegisteredToolSource {
  label: string;
  blockId: string;
  source: TextSourceAnchor;
  includedText: string;
  truncated: boolean;
}

function truncateAtBoundary(text: string, maxCharacters: number): string {
  if (maxCharacters <= 0) return "";
  if (text.length <= maxCharacters) return text;
  if (maxCharacters < 80) return text.slice(0, maxCharacters);
  const preferred = text.lastIndexOf(" ", maxCharacters - 1);
  const cut = preferred >= Math.floor(maxCharacters * 0.7) ? preferred : maxCharacters;
  return `${text.slice(0, Math.max(0, cut - 1)).trimEnd()}…`;
}

function success(text: string): ReaderDynamicToolResult { return { success: true, contentItems: [{ type: "inputText", text }] }; }
function failure(text: string): ReaderDynamicToolResult { return { success: false, contentItems: [{ type: "inputText", text }] }; }

export const WORKSPACE_TOOL_SPECS: ReaderDynamicToolSpec[] = [
  {
    type: "function", name: "lensmap_compose_map",
    description: "Submit exactly one structured Map Draft for this successful Explore turn. This does not write to the database. Prefer the smallest semantic structure that preserves the understanding; do not create decorative diagrams.",
    inputSchema: z.toJSONSchema(mapDraftSchema, { target: "draft-07" }) as Record<string, unknown>,
  },
  {
    type: "function", name: "workspace_expand_source",
    description: "Read nearby structured text around an existing S# source in its original PDF. Use this to verify local context before making causal, definitional, or comparative claims.",
    inputSchema: { type: "object", properties: { sourceLabel: { type: "string", pattern: "^S[0-9]+$" }, before: { type: "integer", minimum: 0, maximum: 4, default: 1 }, after: { type: "integer", minimum: 0, maximum: 4, default: 1 } }, required: ["sourceLabel"], additionalProperties: false },
  },
  {
    type: "function", name: "workspace_search",
    description: "Search one or more PDFs in the active Reader Workspace. Results are candidates only; use workspace_read_blocks before citing them.",
    inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 1000 }, bookIds: { type: "array", maxItems: 16, items: { type: "string", minLength: 1 } }, limit: { type: "integer", minimum: 1, maximum: 16, default: 8 } }, required: ["query"], additionalProperties: false },
  },
  {
    type: "function", name: "workspace_read_blocks",
    description: "Read selected search results from any PDF in the active Workspace and materialize them as citeable S# sources.",
    inputSchema: { type: "object", properties: { blocks: { type: "array", minItems: 1, maxItems: 16, items: { type: "object", properties: { bookId: { type: "string", minLength: 1 }, blockId: { type: "string", minLength: 1 } }, required: ["bookId", "blockId"], additionalProperties: false } } }, required: ["blocks"], additionalProperties: false },
  },
  {
    type: "function", name: "workspace_list_sections",
    description: "List sections in a specific PDF in the active Workspace. Results identify sections but are not citation sources.",
    inputSchema: { type: "object", properties: { bookId: { type: "string", minLength: 1 }, query: { type: "string", maxLength: 500 } }, required: ["bookId"], additionalProperties: false },
  },
  {
    type: "function", name: "workspace_read_section",
    description: "Read a bounded section from a specific PDF in the active Workspace and materialize its text as citeable S# sources.",
    inputSchema: { type: "object", properties: { bookId: { type: "string", minLength: 1 }, sectionId: { type: "string", minLength: 1 }, maxBlocks: { type: "integer", minimum: 1, maximum: 12, default: 8 } }, required: ["bookId", "sectionId"], additionalProperties: false },
  },
];
