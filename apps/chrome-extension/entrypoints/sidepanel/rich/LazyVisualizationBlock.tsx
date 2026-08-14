import { Component, lazy, Suspense, type ReactNode } from "react";
import type { ExploreMessageSource } from "@lensmap/shared";

const VisualizationBlock = lazy(async () => {
  const module = await import("./VisualizationBlock");
  return { default: module.VisualizationBlock };
});

export function LazyVisualizationBlock(props: {
  json: string;
  sources: ExploreMessageSource[];
  onOpenSource: (source: ExploreMessageSource) => void;
}) {
  return (
    <VisualizationErrorBoundary json={props.json}>
      <Suspense fallback={<div className="rich-loading">図表を描画中…</div>}>
        <VisualizationBlock {...props} />
      </Suspense>
    </VisualizationErrorBoundary>
  );
}

class VisualizationErrorBoundary extends Component<{ json: string; children: ReactNode }, { error: string | null }> {
  public override state = { error: null as string | null };
  public static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : "図表レンダラーでエラーが発生しました" }; }
  public override componentDidCatch(): void { /* Visible block-local fallback is sufficient. */ }
  public override render() {
    if (!this.state.error) return this.props.children;
    return <div className="rich-error"><strong>図表を描画できませんでした</strong><span>{this.state.error}</span><pre>{this.props.json}</pre></div>;
  }
}
