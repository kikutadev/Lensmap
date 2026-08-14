import type { ArtifactBlock, GroundingKind, GroundingStatus } from "@deep-reader/shared";
import { visualizationSchema } from "@deep-reader/visualization";

export interface ArtifactSourceLabel {
  label: string;
  sourceAnchorId: string;
}

export interface ParsedArtifactBlock extends Omit<ArtifactBlock, "id" | "order"> {
  invalidSourceLabels: string[];
}

const SOURCE_REFERENCE = /\[(S\d+)\]/g;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

/**
 * Split assistant Markdown into durable artifact blocks without executing model output.
 * Mermaid, validated Visualization DSL, and GFM tables receive explicit block kinds.
 */
export function parseMarkdownArtifactBlocks(
  markdown: string,
  sources: ArtifactSourceLabel[],
): ParsedArtifactBlock[] {
  const labelToSource = new Map(sources.map((source) => [source.label, source.sourceAnchorId]));
  const rawBlocks = splitMarkdown(markdown);

  return rawBlocks.map((block) => {
    const bracketLabels = Array.from(block.text.matchAll(SOURCE_REFERENCE))
      .flatMap((match) => match[1] ? [match[1]] : []);
    const uniqueLabels = [...new Set([...bracketLabels, ...block.declaredSourceLabels])];
    const sourceRefs = uniqueLabels.flatMap((label) => {
      const sourceAnchorId = labelToSource.get(label);
      return sourceAnchorId ? [{ label, sourceAnchorId }] : [];
    });
    const sourceAnchorIds = sourceRefs.map((sourceRef) => sourceRef.sourceAnchorId);
    const invalidSourceLabels = uniqueLabels.filter((label) => !labelToSource.has(label));
    const { groundingKind, groundingStatus } = classifyGrounding(
      block.text,
      sourceAnchorIds.length,
      invalidSourceLabels.length,
      sources.length,
    );

    return {
      kind: block.kind,
      content: block.content,
      sourceAnchorIds,
      sourceRefs,
      groundingKind,
      groundingStatus,
      invalidSourceLabels,
    };
  });
}

interface RawBlock {
  kind: "markdown" | "table" | "diagram" | "chart";
  text: string;
  content: unknown;
  declaredSourceLabels: string[];
}

function splitMarkdown(markdown: string): RawBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: RawBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const currentLine = lines[index] ?? "";
    if (!currentLine.trim()) {
      index += 1;
      continue;
    }

    const fence = currentLine.match(/^\s*```\s*([\w-]*)\s*$/);
    if (fence) {
      const language = (fence[1] ?? "").toLowerCase();
      const collected = [currentLine];
      index += 1;
      while (index < lines.length) {
        const line = lines[index] ?? "";
        collected.push(line);
        const closes = /^\s*```\s*$/.test(line);
        index += 1;
        if (closes) break;
      }
      const text = collected.join("\n");
      const hasClosingFence = collected.at(-1)?.trim() === "```";
      const body = collected.slice(1, hasClosingFence ? -1 : undefined).join("\n").trim();
      if (language === "mermaid") {
        blocks.push({
          kind: "diagram",
          text,
          content: { format: "mermaid", source: body },
          declaredSourceLabels: [],
        });
      } else if (language === "visualization" || language === "deep-reader-viz") {
        const visualization = parseVisualization(body);
        if (visualization) {
          blocks.push({
            kind: visualization.type === "chart" ? "chart" : "diagram",
            text,
            content: { format: "visualization", visualization },
            declaredSourceLabels: visualization.sourceRefs,
          });
        } else {
          blocks.push({
            kind: "markdown",
            text,
            content: { markdown: text },
            declaredSourceLabels: [],
          });
        }
      } else {
        blocks.push({
          kind: "markdown",
          text,
          content: { markdown: text },
          declaredSourceLabels: [],
        });
      }
      continue;
    }

    if (looksLikeTable(lines, index)) {
      const collected: string[] = [];
      while (index < lines.length) {
        const line = lines[index] ?? "";
        if (!line.trim() || !line.includes("|")) break;
        collected.push(line);
        index += 1;
      }
      const text = collected.join("\n");
      blocks.push({ kind: "table", text, content: { markdown: text }, declaredSourceLabels: [] });
      continue;
    }

    const collected: string[] = [];
    while (index < lines.length) {
      const line = lines[index] ?? "";
      if (!line.trim()) break;
      if (collected.length > 0 && (/^\s*```/.test(line) || looksLikeTable(lines, index))) break;
      collected.push(line);
      index += 1;
    }
    const text = collected.join("\n");
    blocks.push({ kind: "markdown", text, content: { markdown: text }, declaredSourceLabels: [] });
  }

  return blocks.length > 0
    ? blocks
    : [{ kind: "markdown", text: markdown, content: { markdown }, declaredSourceLabels: [] }];
}

function looksLikeTable(lines: string[], index: number): boolean {
  const currentLine = lines[index] ?? "";
  const nextLine = lines[index + 1] ?? "";
  return currentLine.includes("|") && TABLE_SEPARATOR.test(nextLine);
}

function parseVisualization(body: string) {
  try {
    return visualizationSchema.parse(JSON.parse(body));
  } catch {
    return null;
  }
}

function classifyGrounding(
  text: string,
  validSourceCount: number,
  invalidSourceCount: number,
  availableSourceCount: number,
): { groundingKind: GroundingKind; groundingStatus: GroundingStatus } {
  if (invalidSourceCount > 0) {
    return {
      groundingKind: validSourceCount > 0 ? "source-backed" : "ai-explanation",
      groundingStatus: "needs-review",
    };
  }
  if (validSourceCount > 0) {
    return {
      groundingKind: hasExplicitDerivationSignal(text) ? "derived" : "source-backed",
      groundingStatus: "references-checked",
    };
  }
  if (/補足\s*[（(]書籍外[）)]/.test(text) || availableSourceCount === 0) {
    return { groundingKind: "ai-explanation", groundingStatus: "needs-review" };
  }
  return { groundingKind: "ai-explanation", groundingStatus: "needs-review" };
}

/** Only explicit language can classify a block as derived; citation count alone never implies derivation. */
function hasExplicitDerivationSignal(text: string): boolean {
  return /(?:推論|導出|算出|計算|derived|inference)/iu.test(text);
}
