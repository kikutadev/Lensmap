import type { ExploreMessageSource } from "@lensmap/shared";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { LazyVisualizationBlock } from "./LazyVisualizationBlock";
import { MermaidDiagram } from "./MermaidDiagram";
import { splitRichContent } from "./content-segments";
import { SourceReference } from "./SourceReference";

export function RichMessage({ markdown, sources, onOpenSource }: {
  markdown: string;
  sources: ExploreMessageSource[];
  onOpenSource: (source: ExploreMessageSource) => void;
}) {
  return (
    <div className="rich-message">
      {splitRichContent(markdown).map((segment, index) => {
        if (segment.kind === "mermaid") return <MermaidDiagram key={`mermaid-${index}`} source={segment.source} />;
        if (segment.kind === "visualization") return <LazyVisualizationBlock key={`viz-${index}`} json={segment.json} sources={sources} onOpenSource={onOpenSource} />;
        return <MarkdownSegment key={`markdown-${index}`} markdown={segment.content} sources={sources} onOpenSource={onOpenSource} />;
      })}
    </div>
  );
}

function MarkdownSegment({ markdown, sources, onOpenSource }: {
  markdown: string;
  sources: ExploreMessageSource[];
  onOpenSource: (source: ExploreMessageSource) => void;
}) {
  const byLabel = new Map(sources.map((source) => [source.label, source]));
  const linked = markdown.replace(/\[S(\d+)\]/g, "[S$1](#source-S$1)");
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      components={{
        h1: ({ children }) => <h1 className="rich-h1">{children}</h1>,
        h2: ({ children }) => <h2 className="rich-h2">{children}</h2>,
        h3: ({ children }) => <h3 className="rich-h3">{children}</h3>,
        p: ({ children }) => <p className="rich-p">{children}</p>,
        ul: ({ children }) => <ul className="rich-list">{children}</ul>,
        ol: ({ children, start }) => <ol className="rich-list ordered" start={start}>{children}</ol>,
        blockquote: ({ children }) => <blockquote className="rich-quote">{children}</blockquote>,
        table: ({ children }) => <div className="table-scroll"><table className="rich-table">{children}</table></div>,
        pre: ({ children }) => <pre className="rich-pre">{children}</pre>,
        code: ({ children, className }) => className ? <code className={className}>{children}</code> : <code className="rich-code">{children}</code>,
        a: ({ href, children }) => {
          const label = href?.match(/^#source-(S\d+)$/)?.[1];
          if (label) {
            const source = byLabel.get(label);
            if (!source) return <span className="missing-source">{children}</span>;
            return <SourceReference source={source} onOpen={onOpenSource} />;
          }
          return <a className="rich-link" href={href} target="_blank" rel="noreferrer">{children}</a>;
        },
      }}
    >{linked}</ReactMarkdown>
  );
}
