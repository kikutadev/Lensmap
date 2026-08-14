export type RichContentSegment =
  | { kind: "markdown"; content: string }
  | { kind: "mermaid"; source: string }
  | { kind: "visualization"; json: string };

const SPECIAL_FENCE = /^\s*```\s*(mermaid|visualization|lensmap-viz)\s*$/i;
const CLOSING_FENCE = /^\s*```\s*$/;

/** Extract only explicitly allow-listed rich-content fences; all other code remains inert Markdown. */
export function splitRichContent(markdown: string): RichContentSegment[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const segments: RichContentSegment[] = [];
  let markdownBuffer: string[] = [];
  let index = 0;

  const flushMarkdown = () => {
    const content = markdownBuffer.join("\n").trim();
    if (content) segments.push({ kind: "markdown", content });
    markdownBuffer = [];
  };

  while (index < lines.length) {
    const current = lines[index] ?? "";
    const special = current.match(SPECIAL_FENCE);
    if (!special) {
      markdownBuffer.push(current);
      index += 1;
      continue;
    }
    const closingIndex = findClosingFence(lines, index + 1);
    if (closingIndex < 0) {
      markdownBuffer.push(current);
      index += 1;
      continue;
    }

    flushMarkdown();
    const body = lines.slice(index + 1, closingIndex).join("\n").trim();
    const language = (special[1] ?? "").toLowerCase();
    segments.push(language === "mermaid"
      ? { kind: "mermaid", source: body }
      : { kind: "visualization", json: body });
    index = closingIndex + 1;
  }

  flushMarkdown();
  return segments.length > 0 ? segments : [{ kind: "markdown", content: markdown }];
}

function findClosingFence(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (CLOSING_FENCE.test(lines[index] ?? "")) return index;
  }
  return -1;
}
