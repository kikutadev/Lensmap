import type { ChatMessageSource } from "@deep-reader/shared";
import { visualizationSchema, type ChartVisualization, type Visualization } from "@deep-reader/visualization";
import { ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";

interface Props {
  json: string;
  sources: ChatMessageSource[];
  onOpenSource: (source: ChatMessageSource) => void;
}

/** Parse model JSON through the allow-listed Visualization DSL before rendering any React visualization. */
export function VisualizationBlock({ json, sources, onOpenSource }: Props) {
  let decoded: unknown;
  try { decoded = JSON.parse(json); } catch { return <InvalidVisualization json={json} />; }
  const parsed = visualizationSchema.safeParse(decoded);
  if (!parsed.success) return <InvalidVisualization json={json} />;
  const sourceByLabel = new Map(sources.map((source) => [source.label, source]));
  const invalidRefs = parsed.data.sourceRefs.filter((label) => !sourceByLabel.has(label));

  return (
    <section className="viz-card">
      <div className="viz-heading">
        <strong>{parsed.data.title}</strong>
        {parsed.data.type === "chart" ? <DataNatureBadge nature={parsed.data.dataNature} /> : null}
      </div>
      <VisualizationBody visualization={parsed.data} />
      {invalidRefs.length ? <div className="rich-warning">未知の参照ID: {invalidRefs.join(", ")}</div> : null}
      {parsed.data.sourceRefs.length ? (
        <div className="citation-row">
          {parsed.data.sourceRefs.flatMap((label) => {
            const source = sourceByLabel.get(label);
            return source ? [<button key={`${label}-${source.sourceAnchorId}`} onClick={() => onOpenSource(source)}>{label} · PDF p.{source.pageStart + 1}</button>] : [];
          })}
        </div>
      ) : null}
    </section>
  );
}

function VisualizationBody({ visualization }: { visualization: Visualization }) {
  switch (visualization.type) {
    case "comparison": return <div className="viz-comparison">{visualization.columns.map((column) => <article key={column.title}><strong>{column.title}</strong><ul>{column.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></article>)}</div>;
    case "flow": return <Flow visualization={visualization} />;
    case "hierarchy": return <div className="viz-hierarchy">{visualization.nodes.map((node) => <div key={node.id} style={{ marginLeft: `${hierarchyDepth(node.id, visualization.nodes) * 12}px` }}><strong>{node.label}</strong>{node.detail ? <span>{node.detail}</span> : null}</div>)}</div>;
    case "timeline": return <ol className="viz-timeline">{visualization.items.map((item, index) => <li key={`${index}-${item.label}`}><span>{item.time}</span><strong>{item.label}</strong>{item.description ? <p>{item.description}</p> : null}</li>)}</ol>;
    case "matrix": return <Matrix visualization={visualization} />;
    case "callout": return <div className={`viz-callout ${visualization.tone}`}><strong>{visualization.body}</strong>{visualization.bullets.length ? <ul>{visualization.bullets.map((bullet, index) => <li key={`${index}-${bullet}`}>{bullet}</li>)}</ul> : null}</div>;
    case "chart": return <Chart visualization={visualization} />;
  }
}

function Flow({ visualization }: { visualization: Extract<Visualization, { type: "flow" }> }) {
  const ids = new Set(visualization.nodes.map((node) => node.id));
  const nodes: Node[] = visualization.nodes.map((node, index) => ({
    id: node.id,
    position: visualization.direction === "TB" ? { x: (index % 2) * 180, y: Math.floor(index / 2) * 105 } : { x: Math.floor(index / 2) * 190, y: (index % 2) * 90 },
    data: { label: node.detail ? `${node.label}\n${node.detail}` : node.label },
    style: { width: 150, whiteSpace: "pre-wrap", fontSize: 10 },
  }));
  const edges: Edge[] = visualization.edges.flatMap((edge, index) => ids.has(edge.source) && ids.has(edge.target)
    ? [{ id: `${index}-${edge.source}-${edge.target}`, source: edge.source, target: edge.target, label: edge.label }]
    : []);
  return <div className="viz-flow"><ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} /></div>;
}

function Matrix({ visualization }: { visualization: Extract<Visualization, { type: "matrix" }> }) {
  const cells = new Map(visualization.cells.map((cell) => [`${cell.row}:${cell.column}`, cell.text]));
  return <div className="table-scroll"><table className="rich-table"><thead><tr><th />{visualization.columnLabels.map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{visualization.rowLabels.map((row, rowIndex) => <tr key={row}><th>{row}</th>{visualization.columnLabels.map((column, columnIndex) => <td key={column}>{cells.get(`${rowIndex}:${columnIndex}`) ?? ""}</td>)}</tr>)}</tbody></table></div>;
}

function Chart({ visualization }: { visualization: ChartVisualization }) {
  if (!visualization.data.length) return <div className="rich-loading">表示するデータがありません。</div>;
  if (visualization.chartType === "bar") return <div className="viz-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={visualization.data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey={visualization.xKey} tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} /><Tooltip /><Legend />{visualization.series.map((series) => <Bar key={series.dataKey} dataKey={series.dataKey} name={series.label} />)}</BarChart></ResponsiveContainer></div>;
  if (visualization.chartType === "line") return <div className="viz-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={visualization.data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey={visualization.xKey} tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} /><Tooltip /><Legend />{visualization.series.map((series) => <Line key={series.dataKey} dataKey={series.dataKey} name={series.label} dot={false} />)}</LineChart></ResponsiveContainer></div>;
  const numericX = visualization.data.every((row) => typeof row[visualization.xKey] === "number");
  return <div className="viz-chart"><ResponsiveContainer width="100%" height="100%"><ScatterChart><CartesianGrid strokeDasharray="3 3" /><XAxis type={numericX ? "number" : "category"} dataKey="x" tick={{ fontSize: 9 }} /><YAxis dataKey="y" tick={{ fontSize: 9 }} /><Tooltip /><Legend />{visualization.series.map((series) => <Scatter key={series.dataKey} name={series.label} data={visualization.data.flatMap((row) => { const x = row[visualization.xKey]; const y = row[series.dataKey]; return (typeof x === "number" || typeof x === "string") && typeof y === "number" ? [{ x, y }] : []; })} />)}</ScatterChart></ResponsiveContainer></div>;
}

function InvalidVisualization({ json }: { json: string }) { return <div className="rich-error"><strong>図表データを安全に解釈できませんでした</strong><pre>{json}</pre></div>; }
function DataNatureBadge({ nature }: { nature: "source" | "derived" | "illustrative" }) { return <span className={`data-nature ${nature}`}>{nature === "source" ? "書籍の数値" : nature === "derived" ? "根拠から算出" : "説明用の例示"}</span>; }
function hierarchyDepth(id: string, nodes: Extract<Visualization, { type: "hierarchy" }>["nodes"]): number { const byId = new Map(nodes.map((node) => [node.id, node])); let depth = 0; let current = byId.get(id); const seen = new Set<string>(); while (current?.parentId && depth < 8 && !seen.has(current.id)) { seen.add(current.id); const parent = byId.get(current.parentId); if (!parent) break; current = parent; depth += 1; } return depth; }
