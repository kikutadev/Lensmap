import type { ChatMessageSource } from "@deep-reader/shared";
import {
  visualizationSchema,
  type ChartVisualization,
  type Visualization,
} from "@deep-reader/visualization";
import { ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatSourcePage } from "../chat/source-display";

interface VisualizationBlockProps {
  json: string;
  sources: ChatMessageSource[];
  onOpenSource: (source: ChatMessageSource) => void;
}

/** Validate model-produced JSON against the allow-listed Visualization DSL before rendering React components. */
export function VisualizationBlock({ json, sources, onOpenSource }: VisualizationBlockProps) {
  const decoded = parseJson(json);
  const parsed = decoded.ok ? visualizationSchema.safeParse(decoded.value) : null;
  if (!decoded.ok || !parsed?.success) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <div className="mb-2 font-semibold">図表データを安全に解釈できませんでした</div>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5">{json}</pre>
      </div>
    );
  }

  const sourceByLabel = new Map(sources.map((source) => [source.label, source]));
  const sourceRefs = parsed.data.sourceRefs;
  const invalidRefs = sourceRefs.filter((label) => !sourceByLabel.has(label));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{parsed.data.title}</h3>
        {parsed.data.type === "chart" ? <DataNatureBadge nature={parsed.data.dataNature} /> : null}
      </div>
      <VisualizationBody visualization={parsed.data} />
      {invalidRefs.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
          未知の参照ID: {invalidRefs.join(", ")}。この図表の根拠は要確認です。
        </div>
      ) : null}
      {sourceRefs.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
          {sourceRefs.flatMap((label) => {
            const source = sourceByLabel.get(label);
            if (!source) return [];
            return [(
              <button
                key={`${label}-${source.sourceAnchorId}`}
                className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-50"
                onClick={() => onOpenSource(source)}
              >{label} · {formatSourcePage(source)}</button>
            )];
          })}
        </div>
      ) : null}
    </section>
  );
}

function VisualizationBody({ visualization }: { visualization: Visualization }) {
  switch (visualization.type) {
    case "comparison":
      return <ComparisonView visualization={visualization} />;
    case "flow":
      return <FlowView visualization={visualization} />;
    case "hierarchy":
      return <HierarchyView visualization={visualization} />;
    case "timeline":
      return <TimelineView visualization={visualization} />;
    case "matrix":
      return <MatrixView visualization={visualization} />;
    case "callout":
      return <CalloutView visualization={visualization} />;
    case "chart":
      return <ChartView visualization={visualization} />;
  }
}

function ComparisonView({ visualization }: { visualization: Extract<Visualization, { type: "comparison" }> }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${visualization.columns.length}, minmax(0, 1fr))` }}>
      {visualization.columns.map((column) => (
        <div key={column.title} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-xs font-semibold text-slate-800">{column.title}</div>
          <ul className="space-y-1.5 text-xs leading-5 text-slate-600">
            {column.items.map((item, index) => <li key={`${column.title}-${index}`} className="flex gap-2"><span aria-hidden>•</span><span>{item}</span></li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

function FlowView({ visualization }: { visualization: Extract<Visualization, { type: "flow" }> }) {
  const nodeIds = new Set(visualization.nodes.map((node) => node.id));
  const nodes: Node[] = visualization.nodes.map((node, index) => ({
    id: node.id,
    position: visualization.direction === "TB"
      ? { x: (index % 3) * 220, y: Math.floor(index / 3) * 130 }
      : { x: Math.floor(index / 3) * 240, y: (index % 3) * 110 },
    data: {
      label: node.detail ? `${node.label}\n${node.detail}` : node.label,
    },
    style: { width: 180, whiteSpace: "pre-wrap", fontSize: 12 },
  }));
  const edges: Edge[] = visualization.edges.flatMap((edge, index) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return [];
    return [{
      id: `${edge.source}-${edge.target}-${index}`,
      source: edge.source,
      target: edge.target,
      label: edge.label,
    }];
  });

  return (
    <div className="h-80 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} />
    </div>
  );
}

function HierarchyView({ visualization }: { visualization: Extract<Visualization, { type: "hierarchy" }> }) {
  const byId = new Map(visualization.nodes.map((node) => [node.id, node]));
  return (
    <div className="space-y-2">
      {visualization.nodes.map((node) => {
        const depth = hierarchyDepth(node.id, byId);
        return (
          <div key={node.id} className="flex" style={{ paddingLeft: `${Math.min(depth, 8) * 20}px` }}>
            <div className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-xs font-semibold text-slate-800">{node.label}</div>
              {node.detail ? <div className="mt-1 text-[11px] leading-5 text-slate-500">{node.detail}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimelineView({ visualization }: { visualization: Extract<Visualization, { type: "timeline" }> }) {
  return (
    <ol className="space-y-0">
      {visualization.items.map((item, index) => (
        <li key={`${item.time ?? "item"}-${item.label}-${index}`} className="grid grid-cols-[20px_minmax(0,1fr)] gap-3">
          <div className="flex flex-col items-center">
            <div className="mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-slate-400 bg-white" />
            {index < visualization.items.length - 1 ? <div className="min-h-10 flex-1 border-l border-slate-300" /> : null}
          </div>
          <div className="pb-4">
            {item.time ? <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.time}</div> : null}
            <div className="text-xs font-semibold text-slate-800">{item.label}</div>
            {item.description ? <div className="mt-1 text-[11px] leading-5 text-slate-600">{item.description}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function MatrixView({ visualization }: { visualization: Extract<Visualization, { type: "matrix" }> }) {
  const cells = new Map(
    visualization.cells
      .filter((cell) => cell.row < visualization.rowLabels.length && cell.column < visualization.columnLabels.length)
      .map((cell) => [`${cell.row}:${cell.column}`, cell.text]),
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr>
            <th className="border border-slate-200 bg-slate-50 px-2 py-2" />
            {visualization.columnLabels.map((label) => <th key={label} className="border border-slate-200 bg-slate-50 px-2 py-2 font-semibold text-slate-700">{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {visualization.rowLabels.map((rowLabel, row) => (
            <tr key={rowLabel}>
              <th className="border border-slate-200 bg-slate-50 px-2 py-2 font-semibold text-slate-700">{rowLabel}</th>
              {visualization.columnLabels.map((columnLabel, column) => (
                <td key={`${rowLabel}-${columnLabel}`} className="border border-slate-200 px-2 py-2 align-top text-slate-600">
                  {cells.get(`${row}:${column}`) ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalloutView({ visualization }: { visualization: Extract<Visualization, { type: "callout" }> }) {
  const label = visualization.tone === "definition"
    ? "定義"
    : visualization.tone === "important"
      ? "重要"
      : visualization.tone === "warning"
        ? "注意"
        : "補足";
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <p className="whitespace-pre-wrap text-xs leading-6 text-slate-700">{visualization.body}</p>
      {visualization.bullets.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-600">
          {visualization.bullets.map((bullet, index) => <li key={`${index}-${bullet}`}>{bullet}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function ChartView({ visualization }: { visualization: ChartVisualization }) {
  if (visualization.data.length === 0) {
    return <div className="rounded-lg bg-slate-50 p-4 text-xs text-slate-400">表示するデータがありません。</div>;
  }

  if (visualization.chartType === "bar") {
    return (
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={visualization.data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={visualization.xKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value, name) => formatTooltip(value, name, visualization)} />
            <Legend />
            {visualization.series.map((series) => <Bar key={series.dataKey} dataKey={series.dataKey} name={series.label} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (visualization.chartType === "line") {
    return (
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={visualization.data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={visualization.xKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value, name) => formatTooltip(value, name, visualization)} />
            <Legend />
            {visualization.series.map((series) => (
              <Line key={series.dataKey} type="monotone" dataKey={series.dataKey} name={series.label} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const numericX = visualization.data.every((row) => typeof row[visualization.xKey] === "number");
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type={numericX ? "number" : "category"} dataKey="x" name={visualization.xKey} tick={{ fontSize: 11 }} />
          <YAxis type="number" dataKey="y" tick={{ fontSize: 11 }} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          <Legend />
          {visualization.series.map((series) => (
            <Scatter
              key={series.dataKey}
              name={series.label}
              data={visualization.data.flatMap((row) => {
                const x = row[visualization.xKey];
                const y = row[series.dataKey];
                return (typeof x === "number" || typeof x === "string") && typeof y === "number"
                  ? [{ x, y }]
                  : [];
              })}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function DataNatureBadge({ nature }: { nature: "source" | "derived" | "illustrative" }) {
  const label = nature === "source" ? "書籍の数値" : nature === "derived" ? "根拠から算出" : "説明用の例示";
  const className = nature === "illustrative"
    ? "bg-amber-50 text-amber-700"
    : nature === "derived"
      ? "bg-blue-50 text-blue-700"
      : "bg-emerald-50 text-emerald-700";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${className}`}>{label}</span>;
}

function formatTooltip(
  value: string | number | readonly (string | number)[] | undefined,
  name: string | number | undefined,
  visualization: ChartVisualization,
): [string, string] {
  const series = visualization.series.find((candidate) => candidate.dataKey === String(name) || candidate.label === String(name));
  const scalar = Array.isArray(value) ? value.join(", ") : value ?? "";
  return [`${series?.valuePrefix ?? ""}${String(scalar)}${series?.valueSuffix ?? ""}`, series?.label ?? String(name ?? "")];
}

function hierarchyDepth(
  id: string,
  byId: Map<string, Extract<Visualization, { type: "hierarchy" }>["nodes"][number]>,
): number {
  let depth = 0;
  let current = byId.get(id);
  const seen = new Set<string>();
  while (current?.parentId && depth < 8 && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

function parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}
