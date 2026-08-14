import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { ChatMessageSource } from "@deep-reader/shared";
import { MermaidDiagram } from "../rich-content/MermaidDiagram";
import { LazyVisualizationBlock } from "../rich-content/LazyVisualizationBlock";
import { splitRichContent } from "../rich-content/content-segments";
import { formatSourcePage } from "./source-display";

interface MarkdownMessageProps {
  markdown: string;
  sources: ChatMessageSource[];
  onOpenSource: (source: ChatMessageSource) => void;
}

function linkifySourceReferences(markdown: string): string {
  return markdown.replace(/\[S(\d+)\]/g, "[S$1](#source-S$1)");
}

/**
 * Render safe assistant rich content. Markdown is sanitized, Mermaid is allow-listed,
 * and React visualizations require schema-valid JSON rather than arbitrary model JSX/JavaScript.
 */
export function MarkdownMessage({ markdown, sources, onOpenSource }: MarkdownMessageProps) {
  const segments = splitRichContent(markdown);

  return (
    <div className="space-y-3 text-sm leading-7 text-slate-700">
      {segments.map((segment, index) => {
        if (segment.kind === "mermaid") {
          return <MermaidDiagram key={`mermaid-${index}`} source={segment.source} />;
        }
        if (segment.kind === "visualization") {
          return (
            <LazyVisualizationBlock
              key={`visualization-${index}`}
              json={segment.json}
              sources={sources}
              onOpenSource={onOpenSource}
            />
          );
        }
        return (
          <MarkdownSegment
            key={`markdown-${index}`}
            markdown={segment.content}
            sources={sources}
            onOpenSource={onOpenSource}
          />
        );
      })}
    </div>
  );
}

function MarkdownSegment({ markdown, sources, onOpenSource }: MarkdownMessageProps) {
  const byLabel = new Map(sources.map((source) => [source.label, source]));
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      components={{
        h1: ({ children }) => <h1 className="mt-5 text-xl font-semibold text-slate-950">{children}</h1>,
        h2: ({ children }) => <h2 className="mt-5 text-lg font-semibold text-slate-950">{children}</h2>,
        h3: ({ children }) => <h3 className="mt-4 text-base font-semibold text-slate-950">{children}</h3>,
        p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
        ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children, start }) => <ol start={start} className="list-decimal space-y-1 pl-5">{children}</ol>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-slate-300 pl-3 text-slate-600">{children}</blockquote>,
        table: ({ children }) => <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-xs">{children}</table></div>,
        th: ({ children }) => <th className="border border-slate-200 bg-slate-50 px-2 py-1.5 font-semibold text-slate-700">{children}</th>,
        td: ({ children }) => <td className="border border-slate-200 px-2 py-1.5 align-top">{children}</td>,
        pre: ({ children }) => <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-100">{children}</pre>,
        code: ({ children, className }) => className
          ? <code className={className}>{children}</code>
          : <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.9em] text-slate-800">{children}</code>,
        a: ({ href, children }) => {
          const label = href?.match(/^#source-(S\d+)$/)?.[1];
          if (label) {
            const source = byLabel.get(label);
            if (!source) {
              return <span className="rounded bg-amber-50 px-1 py-0.5 text-amber-700">{children}</span>;
            }
            return (
              <button
                type="button"
                className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                title={formatSourcePage(source)}
                onClick={() => onOpenSource(source)}
              >
                {children}
              </button>
            );
          }
          return <a className="text-blue-700 underline underline-offset-2" href={href} target="_blank" rel="noreferrer">{children}</a>;
        },
      }}
    >
      {linkifySourceReferences(markdown)}
    </ReactMarkdown>
  );
}
