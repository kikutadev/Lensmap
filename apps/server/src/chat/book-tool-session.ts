import { z } from "zod";
import type { SourceAnchor } from "@deep-reader/shared";
import type {
  DynamicToolCallParams,
} from "../codex/protocol.js";
import type {
  ReaderDynamicToolResult,
  ReaderDynamicToolSpec,
} from "../codex/app-server-client.js";
import type { BookContextGateway, MaterializedBookSource } from "../documents/book-context-gateway.js";

interface BookToolLimits {
  maxToolCalls: number;
  maxMaterializedSources: number;
  maxRetrievedCharacters: number;
}

const DEFAULT_LIMITS: BookToolLimits = {
  maxToolCalls: 10,
  maxMaterializedSources: 12,
  maxRetrievedCharacters: 18_000,
};

const expandInputSchema = z.object({
  sourceLabel: z.string().regex(/^S\d+$/),
  before: z.number().int().default(1).transform((value) => Math.min(Math.max(value, 0), 4)),
  after: z.number().int().default(1).transform((value) => Math.min(Math.max(value, 0), 4)),
});

const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(1_000),
  limit: z.number().int().default(6).transform((value) => Math.min(Math.max(value, 1), 12)),
});

const readBlocksInputSchema = z.object({
  blockIds: z.array(z.string().min(1)).min(1).transform((ids) => ids.slice(0, 12)),
});

const listSectionsInputSchema = z.object({
  query: z.string().trim().max(500).optional(),
});

const readSectionInputSchema = z.object({
  sectionId: z.string().min(1),
  maxBlocks: z.number().int().default(8).transform((value) => Math.min(Math.max(value, 1), 12)),
});

export interface BookToolSourceLink {
  sourceAnchorId: string;
  sourceLabel: string;
  sourceOrder: number;
  includedText: string;
  truncated: boolean;
}

export interface BookToolAuditEvent {
  toolName: string;
  arguments: unknown;
  resultSummary: unknown;
  createdAt: string;
}

export interface BookToolSessionOptions {
  bookId: string;
  explicitSources: Array<{ label: string; source: SourceAnchor }>;
  gateway: BookContextGateway;
  limits?: Partial<BookToolLimits>;
}

/**
 * Per-turn read-only retrieval state. It gives Codex bounded book tools while preserving stable S# labels
 * and an auditable record of what text actually entered the model context.
 */
export class BookToolSession {
  public readonly specs: ReaderDynamicToolSpec[] = BOOK_TOOL_SPECS;
  private readonly bookId: string;
  private readonly gateway: BookContextGateway;
  private readonly limits: BookToolLimits;
  private readonly labelToSource = new Map<string, SourceAnchor>();
  private readonly sourceIdToLabel = new Map<string, string>();
  private readonly materialized = new Map<string, BookToolSourceLink>();
  private readonly auditEvents: BookToolAuditEvent[] = [];
  private nextSourceNumber: number;
  private toolCalls = 0;
  private retrievedCharacters = 0;

  public constructor(options: BookToolSessionOptions) {
    this.bookId = options.bookId;
    this.gateway = options.gateway;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    let maxSourceNumber = 0;
    for (const explicit of options.explicitSources) {
      this.labelToSource.set(explicit.label, explicit.source);
      this.sourceIdToLabel.set(explicit.source.id, explicit.label);
      const number = Number(explicit.label.slice(1));
      if (Number.isFinite(number)) maxSourceNumber = Math.max(maxSourceNumber, number);
    }
    this.nextSourceNumber = maxSourceNumber + 1;
  }

  public getSourceLinks(): BookToolSourceLink[] {
    return [...this.materialized.values()].sort((left, right) => left.sourceOrder - right.sourceOrder);
  }

  public getAuditEvents(): BookToolAuditEvent[] {
    return [...this.auditEvents];
  }

  public async handle(request: DynamicToolCallParams): Promise<ReaderDynamicToolResult> {
    if (request.namespace !== null && request.namespace !== "") {
      return failure(`Unsupported tool namespace: ${request.namespace}`);
    }
    if (this.toolCalls >= this.limits.maxToolCalls) {
      return failure("Book context expansion budget exhausted: too many tool calls.");
    }
    this.toolCalls += 1;

    try {
      switch (request.tool) {
        case "book_expand_source":
          return await this.handleExpand(request.arguments);
        case "book_search":
          return await this.handleSearch(request.arguments);
        case "book_read_blocks":
          return await this.handleReadBlocks(request.arguments);
        case "book_list_sections":
          return await this.handleListSections(request.arguments);
        case "book_read_section":
          return await this.handleReadSection(request.arguments);
        default:
          return failure(`Unknown Deep Reader book tool: ${request.tool}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Book retrieval failed";
      this.recordAudit(request.tool, request.arguments, { success: false, error: message });
      return failure(message);
    }
  }

  private async handleSearch(argumentsValue: unknown): Promise<ReaderDynamicToolResult> {
    const input = searchInputSchema.parse(argumentsValue);
    const result = await this.gateway.searchBook(this.bookId, input.query, input.limit);
    const candidates = result.hits.map((hit) => ({
      blockId: hit.block.id,
      pdfPage: hit.block.pageIndex + 1,
      kind: hit.block.kind,
      snippet: hit.snippet,
    }));
    this.recordAudit("book_search", input, { candidateCount: candidates.length, candidates });
    return success([
      "Search candidates only; they are NOT citation sources until read with book_read_blocks.",
      JSON.stringify({ query: result.query, candidates }, null, 2),
    ].join("\n"));
  }

  private async handleListSections(argumentsValue: unknown): Promise<ReaderDynamicToolResult> {
    const input = listSectionsInputSchema.parse(argumentsValue);
    const sections = await this.gateway.listSections(this.bookId, input.query);
    const summary = sections.map((section) => ({
      sectionId: section.id,
      title: section.title,
      pdfPage: section.pageIndex + 1,
      depth: section.depth,
    }));
    this.recordAudit("book_list_sections", input, { sectionCount: summary.length, sections: summary });
    return success([
      "Section candidates only. Use book_read_section with a sectionId to read citeable text.",
      JSON.stringify(summary, null, 2),
    ].join("\n"));
  }

  private async handleReadSection(argumentsValue: unknown): Promise<ReaderDynamicToolResult> {
    const input = readSectionInputSchema.parse(argumentsValue);
    const sources = await this.gateway.readSection(this.bookId, input.sectionId, input.maxBlocks);
    const rendered = this.registerMaterializedSources(sources);
    this.recordAudit("book_read_section", input, {
      sourceLabels: rendered.map((item) => item.label),
      blockIds: rendered.map((item) => item.blockId),
    });
    return success(rendered.length > 0
      ? rendered.map(renderToolSource).join("\n\n")
      : "No section text could be read within the expansion budget.");
  }

  private async handleReadBlocks(argumentsValue: unknown): Promise<ReaderDynamicToolResult> {
    const input = readBlocksInputSchema.parse(argumentsValue);
    const sources = await this.gateway.readBlocks(this.bookId, input.blockIds);
    const rendered = this.registerMaterializedSources(sources);
    this.recordAudit("book_read_blocks", input, {
      sourceLabels: rendered.map((item) => item.label),
      blockIds: rendered.map((item) => item.blockId),
    });
    return success(rendered.length > 0
      ? rendered.map(renderToolSource).join("\n\n")
      : "No additional source could be read within the expansion budget.");
  }

  private async handleExpand(argumentsValue: unknown): Promise<ReaderDynamicToolResult> {
    const input = expandInputSchema.parse(argumentsValue);
    const source = this.labelToSource.get(input.sourceLabel);
    if (!source) return failure(`Unknown source label: ${input.sourceLabel}`);
    const sources = await this.gateway.expandSource(
      this.bookId,
      source.id,
      input.before,
      input.after,
    );
    const rendered = this.registerMaterializedSources(sources);
    this.recordAudit("book_expand_source", input, {
      sourceLabels: rendered.map((item) => item.label),
      blockIds: rendered.map((item) => item.blockId),
    });
    return success(rendered.length > 0
      ? rendered.map(renderToolSource).join("\n\n")
      : `No additional nearby context was available for ${input.sourceLabel}.`);
  }

  private registerMaterializedSources(sources: MaterializedBookSource[]): RegisteredToolSource[] {
    const result: RegisteredToolSource[] = [];
    for (const candidate of sources) {
      const existingLabel = this.sourceIdToLabel.get(candidate.source.id);
      if (existingLabel) {
        const existing = this.materialized.get(candidate.source.id);
        if (existing) {
          result.push({
            label: existingLabel,
            blockId: candidate.blockId,
            source: candidate.source,
            includedText: existing.includedText,
            truncated: existing.truncated,
          });
        }
        continue;
      }
      if (this.materialized.size >= this.limits.maxMaterializedSources) break;
      if (this.retrievedCharacters >= this.limits.maxRetrievedCharacters) break;

      const remaining = this.limits.maxRetrievedCharacters - this.retrievedCharacters;
      const fullText = candidate.source.quoteNormalized;
      const includedText = fullText.length <= remaining
        ? fullText
        : truncateAtBoundary(fullText, remaining);
      if (!includedText) break;
      const truncated = includedText.length < fullText.length;
      const label = `S${this.nextSourceNumber++}`;
      const sourceOrder = Number(label.slice(1)) - 1;
      const link: BookToolSourceLink = {
        sourceAnchorId: candidate.source.id,
        sourceLabel: label,
        sourceOrder,
        includedText,
        truncated,
      };
      this.materialized.set(candidate.source.id, link);
      this.labelToSource.set(label, candidate.source);
      this.sourceIdToLabel.set(candidate.source.id, label);
      this.retrievedCharacters += includedText.length;
      result.push({
        label,
        blockId: candidate.blockId,
        source: candidate.source,
        includedText,
        truncated,
      });
    }
    return result;
  }

  private recordAudit(toolName: string, args: unknown, resultSummary: unknown): void {
    this.auditEvents.push({
      toolName,
      arguments: args,
      resultSummary,
      createdAt: new Date().toISOString(),
    });
  }
}

interface RegisteredToolSource {
  label: string;
  blockId: string;
  source: SourceAnchor;
  includedText: string;
  truncated: boolean;
}

function renderToolSource(item: RegisteredToolSource): string {
  const printed = item.source.printedPageLabelStart?.trim();
  const page = printed
    ? `printed p.${printed} / PDF p.${item.source.pageStart + 1}`
    : `PDF p.${item.source.pageStart + 1}`;
  return [
    `${item.label} | ${page} | ai-expansion | block ${item.blockId}${item.truncated ? " | truncated" : ""}`,
    item.includedText,
    `When relying on this text, cite [${item.label}].`,
  ].join("\n");
}

function truncateAtBoundary(text: string, maxCharacters: number): string {
  if (maxCharacters <= 0) return "";
  if (text.length <= maxCharacters) return text;
  if (maxCharacters < 80) return text.slice(0, maxCharacters);
  const preferred = text.lastIndexOf(" ", maxCharacters - 1);
  const cut = preferred >= Math.floor(maxCharacters * 0.7) ? preferred : maxCharacters;
  return `${text.slice(0, Math.max(0, cut - 1)).trimEnd()}…`;
}

function success(text: string): ReaderDynamicToolResult {
  return { success: true, contentItems: [{ type: "inputText", text }] };
}

function failure(text: string): ReaderDynamicToolResult {
  return { success: false, contentItems: [{ type: "inputText", text }] };
}

export const BOOK_TOOL_SPECS: ReaderDynamicToolSpec[] = [
  {
    type: "function",
    name: "book_expand_source",
    description: "Read a few structured text blocks immediately before/after an existing S# source in the currently open book. Use only when the explicit excerpt lacks nearby context.",
    inputSchema: {
      type: "object",
      properties: {
        sourceLabel: { type: "string", pattern: "^S[0-9]+$" },
        before: { type: "integer", minimum: 0, maximum: 4, default: 1 },
        after: { type: "integer", minimum: 0, maximum: 4, default: 1 },
      },
      required: ["sourceLabel"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "book_search",
    description: "Search the currently open book's local FTS index. Results are candidates only and cannot be cited until book_read_blocks reads the selected block IDs.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 1000 },
        limit: { type: "integer", minimum: 1, maximum: 12, default: 6 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "book_read_blocks",
    description: "Read selected block IDs returned by book_search and turn them into citeable S# sources from the currently open book.",
    inputSchema: {
      type: "object",
      properties: {
        blockIds: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: { type: "string", minLength: 1 },
        },
      },
      required: ["blockIds"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "book_list_sections",
    description: "List embedded or inferred section headings in the currently open book. Results identify sections but are not citation sources.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", maxLength: 500 } },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "book_read_section",
    description: "Read a bounded section returned by book_list_sections and materialize its text as citeable S# sources.",
    inputSchema: {
      type: "object",
      properties: {
        sectionId: { type: "string", minLength: 1 },
        maxBlocks: { type: "integer", minimum: 1, maximum: 12, default: 8 },
      },
      required: ["sectionId"],
      additionalProperties: false,
    },
  },
];
