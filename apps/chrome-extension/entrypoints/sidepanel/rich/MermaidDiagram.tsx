import { useEffect, useId, useState } from "react";

/** Lazy-render Mermaid with strict security so model output cannot inject arbitrary active markup. */
export function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
        const id = `lensmap-extension-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
        const rendered = await mermaid.render(id, source);
        if (!cancelled) setSvg(rendered.svg);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Mermaid図を描画できませんでした");
      });
    return () => { cancelled = true; };
  }, [reactId, source]);

  if (error) return <div className="rich-error"><strong>Mermaidを描画できませんでした</strong><span>{error}</span><pre>{source}</pre></div>;
  if (!svg) return <div className="rich-loading">図を描画中…</div>;
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}
