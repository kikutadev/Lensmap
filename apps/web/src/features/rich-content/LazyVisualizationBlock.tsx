import { Component, lazy, Suspense, type ReactNode } from "react";
import type { ChatMessageSource } from "@deep-reader/shared";

const VisualizationBlock = lazy(async () => {
  const module = await import("./VisualizationBlock");
  return { default: module.VisualizationBlock };
});

interface LazyVisualizationBlockProps {
  json: string;
  sources: ChatMessageSource[];
  onOpenSource: (source: ChatMessageSource) => void;
}

/** Keep chart/graph libraries out of the initial reader bundle and isolate renderer failures per block. */
export function LazyVisualizationBlock(props: LazyVisualizationBlockProps) {
  return (
    <VisualizationErrorBoundary json={props.json}>
      <Suspense fallback={<div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-400">図表を描画中…</div>}>
        <VisualizationBlock {...props} />
      </Suspense>
    </VisualizationErrorBoundary>
  );
}

class VisualizationErrorBoundary extends Component<
  { json: string; children: ReactNode },
  { error: string | null }
> {
  public override state = { error: null as string | null };

  public static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "図表レンダラーでエラーが発生しました" };
  }

  public override componentDidCatch(): void {
    // The visible fallback is sufficient here; no source content is sent to external telemetry.
  }

  public override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <div className="mb-1 font-semibold">図表を描画できませんでした</div>
        <div className="mb-2 text-[11px]">{this.state.error}</div>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-4">{this.props.json}</pre>
      </div>
    );
  }
}
