import { useEffect, useId, useState } from "react";

interface MermaidDiagramProps {
  source: string;
}

/** Render allow-listed Mermaid source lazily with Mermaid's strict security mode. */
export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const reactId = useId();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);

    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
        });
        const renderId = `deep-reader-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
        const rendered = await mermaid.render(renderId, source);
        if (!cancelled) setSvg(rendered.svg);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Mermaid図の描画に失敗しました");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reactId, source]);

  if (error) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <div className="mb-2 font-semibold">Mermaidを描画できませんでした</div>
        <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] leading-5">{source}</pre>
      </div>
    );
  }

  if (!svg) {
    return <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-400">図を描画中…</div>;
  }

  return (
    <div
      className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-3 [&_svg]:mx-auto [&_svg]:max-w-full"
      // Mermaid strict mode sanitizes generated markup; no arbitrary HTML/JS is accepted from the model.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
