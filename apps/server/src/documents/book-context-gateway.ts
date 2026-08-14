import type { BookSearchResponse, DocumentBlock, SourceAnchor } from "@deep-reader/shared";
import type { SourceAnchorService } from "../sources/source-anchor-service.js";
import type { DocumentIndexService } from "./document-index-service.js";

export interface MaterializedBookSource {
  source: SourceAnchor;
  blockId: string;
  reason: "read-block" | "nearby" | "section";
}

/**
 * Read-only gateway exposed to the Codex orchestration layer.
 * Search returns candidates only; SourceAnchors are materialized only when the AI actually reads a block.
 */
export class BookContextGateway {
  public constructor(
    private readonly documentIndexService: DocumentIndexService,
    private readonly sourceAnchorService: SourceAnchorService,
  ) {}

  public async listSections(bookId: string, query?: string) {
    const outline = (await this.documentIndexService.getOutline(bookId)).items;
    const normalized = query?.trim().toLocaleLowerCase().normalize("NFKC");
    return normalized
      ? outline.filter((item) => item.title.toLocaleLowerCase().normalize("NFKC").includes(normalized)).slice(0, 20)
      : outline.slice(0, 40);
  }

  public async searchBook(bookId: string, query: string, limit = 8): Promise<BookSearchResponse> {
    return this.documentIndexService.searchBook(bookId, query, limit);
  }

  public async readBlocks(bookId: string, blockIds: string[]): Promise<MaterializedBookSource[]> {
    const blocks = await this.documentIndexService.getBlocksByIds(bookId, blockIds);
    return Promise.all(blocks.map(async (block) => ({
      source: await this.materializeBlock(bookId, block),
      blockId: block.id,
      reason: "read-block" as const,
    })));
  }

  /** Read one bounded semantic section from embedded/fallback outline structure. */
  public async readSection(bookId: string, sectionId: string, maxBlocks = 12): Promise<MaterializedBookSource[]> {
    const outline = (await this.documentIndexService.getOutline(bookId)).items;
    const index = outline.findIndex((item) => item.id === sectionId);
    if (index < 0) throw new Error(`Document section not found: ${sectionId}`);
    const section = outline[index]!;
    const next = outline.slice(index + 1).find((item) => item.depth <= section.depth);
    const status = this.documentIndexService.getStatus(bookId);
    const lastPage = status.pageCount && status.pageCount > 0 ? status.pageCount - 1 : section.pageIndex + 4;
    const endPage = Math.min(lastPage, next ? Math.max(section.pageIndex, next.pageIndex) : section.pageIndex + 4);
    const candidates: DocumentBlock[] = [];
    const normalizedTitle = section.title.toLocaleLowerCase().normalize("NFKC");

    for (let pageIndex = section.pageIndex; pageIndex <= endPage && candidates.length < maxBlocks * 2; pageIndex += 1) {
      const pageBlocks = await this.documentIndexService.getPageBlocks(bookId, pageIndex);
      let start = 0;
      if (pageIndex === section.pageIndex) {
        const headingIndex = pageBlocks.findIndex((block) =>
          block.textNormalized.toLocaleLowerCase().normalize("NFKC").includes(normalizedTitle),
        );
        if (headingIndex >= 0) start = headingIndex;
      }
      let selected = pageBlocks.slice(start);
      if (next && pageIndex === next.pageIndex) {
        const nextTitle = next.title.toLocaleLowerCase().normalize("NFKC");
        const nextHeading = selected.findIndex((block) =>
          block.textNormalized.toLocaleLowerCase().normalize("NFKC").includes(nextTitle),
        );
        if (nextHeading >= 0) selected = selected.slice(0, nextHeading);
      }
      candidates.push(...selected);
      if (next && pageIndex >= next.pageIndex) break;
    }

    return Promise.all(dedupeBlocks(candidates).slice(0, Math.min(Math.max(maxBlocks, 1), 12)).map(async (block) => ({
      source: await this.materializeBlock(bookId, block),
      blockId: block.id,
      reason: "section" as const,
    })));
  }

  public async expandSource(
    bookId: string,
    sourceAnchorId: string,
    before = 1,
    after = 1,
  ): Promise<MaterializedBookSource[]> {
    const source = this.sourceAnchorService.getById(sourceAnchorId);
    if (!source) throw new Error("SourceAnchor not found");
    if (source.bookId !== bookId) throw new Error("SourceAnchor belongs to another book");

    const boundedBefore = Math.min(Math.max(before, 0), 4);
    const boundedAfter = Math.min(Math.max(after, 0), 4);
    if (boundedBefore === 0 && boundedAfter === 0) return [];

    const currentBlocks = await this.documentIndexService.getPageBlocks(bookId, source.pageStart);
    const currentIndex = await this.locateSourceBlock(source, currentBlocks);
    if (currentIndex === null) {
      return this.fallbackNearbyPages(bookId, source, boundedBefore, boundedAfter);
    }

    const neighbors: DocumentBlock[] = [];
    const beforeStart = Math.max(0, currentIndex - boundedBefore);
    neighbors.push(...currentBlocks.slice(beforeStart, currentIndex));
    neighbors.push(...currentBlocks.slice(currentIndex + 1, currentIndex + 1 + boundedAfter));

    let missingBefore = boundedBefore - (currentIndex - beforeStart);
    let missingAfter = boundedAfter - Math.min(boundedAfter, currentBlocks.length - currentIndex - 1);

    if (missingBefore > 0 && source.pageStart > 0) {
      const previousPage = await this.documentIndexService.getPageBlocks(bookId, source.pageStart - 1);
      neighbors.unshift(...previousPage.slice(Math.max(0, previousPage.length - missingBefore)));
      missingBefore = Math.max(0, missingBefore - previousPage.length);
    }
    if (missingAfter > 0) {
      const status = this.documentIndexService.getStatus(bookId);
      const nextPageIndex = source.pageStart + 1;
      if (status.pageCount === null || nextPageIndex < status.pageCount) {
        const nextPage = await this.documentIndexService.getPageBlocks(bookId, nextPageIndex);
        neighbors.push(...nextPage.slice(0, missingAfter));
        missingAfter = Math.max(0, missingAfter - nextPage.length);
      }
    }

    const unique = dedupeBlocks(neighbors).filter((block) => !source.documentNodeIds.includes(block.id));
    return Promise.all(unique.map(async (block) => ({
      source: await this.materializeBlock(bookId, block),
      blockId: block.id,
      reason: "nearby" as const,
    })));
  }

  private async locateSourceBlock(source: SourceAnchor, blocks: DocumentBlock[]): Promise<number | null> {
    const directIds = new Set(source.documentNodeIds);
    const directIndex = blocks.findIndex((block) => directIds.has(block.id));
    if (directIndex >= 0) return directIndex;

    const normalizedSource = source.quoteNormalized.trim();
    if (!normalizedSource) return null;

    let bestIndex = -1;
    let bestScore = 0;
    blocks.forEach((block, index) => {
      const blockText = block.textNormalized.trim();
      if (!blockText) return;
      if (blockText.includes(normalizedSource) || normalizedSource.includes(blockText)) {
        const minLength = Math.min(blockText.length, normalizedSource.length);
        const maxLength = Math.max(blockText.length, normalizedSource.length);
        const score = maxLength > 0 ? 0.8 + (minLength / maxLength) * 0.2 : 0;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
        return;
      }

      const score = tokenOverlap(normalizedSource, blockText);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    return bestIndex >= 0 && bestScore >= 0.35 ? bestIndex : null;
  }

  private async fallbackNearbyPages(
    bookId: string,
    source: SourceAnchor,
    before: number,
    after: number,
  ): Promise<MaterializedBookSource[]> {
    const candidates: DocumentBlock[] = [];
    if (before > 0 && source.pageStart > 0) {
      const previousPage = await this.documentIndexService.getPageBlocks(bookId, source.pageStart - 1);
      candidates.push(...previousPage.slice(Math.max(0, previousPage.length - before)));
    }
    if (after > 0) {
      const status = this.documentIndexService.getStatus(bookId);
      const nextPageIndex = source.pageEnd + 1;
      if (status.pageCount === null || nextPageIndex < status.pageCount) {
        const nextPage = await this.documentIndexService.getPageBlocks(bookId, nextPageIndex);
        candidates.push(...nextPage.slice(0, after));
      }
    }

    return Promise.all(dedupeBlocks(candidates).map(async (block) => ({
      source: await this.materializeBlock(bookId, block),
      blockId: block.id,
      reason: "nearby" as const,
    })));
  }

  private async materializeBlock(bookId: string, block: DocumentBlock): Promise<SourceAnchor> {
    const page = await this.documentIndexService.getPage(bookId, block.pageIndex);
    return this.sourceAnchorService.createAiExpansion({
      bookId,
      pageIndex: block.pageIndex,
      printedPageLabel: page.printedPageLabel,
      quoteRaw: block.textRaw,
      quoteNormalized: block.textNormalized,
      rects: block.rects,
      documentNodeIds: [block.id],
    });
  }
}

function dedupeBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    if (seen.has(block.id)) return false;
    seen.add(block.id);
    return true;
  });
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let matches = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) matches += 1;
  }
  return matches / Math.min(leftTokens.size, rightTokens.size);
}

function tokenize(value: string): Set<string> {
  const normalized = value.toLocaleLowerCase().normalize("NFKC");
  const wordTokens = normalized.match(/[\p{Letter}\p{Number}_-]{2,}/gu) ?? [];
  if (wordTokens.length > 1) return new Set(wordTokens);
  const compact = normalized.replace(/\s+/gu, "");
  const grams = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    grams.add(compact.slice(index, index + 2));
  }
  return grams;
}
