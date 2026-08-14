import { useEffect, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

interface Props { left: ReactNode; center: ReactNode; right: ReactNode; }
interface LayoutState { leftWidth: number; rightWidth: number; leftCollapsed: boolean; rightCollapsed: boolean; }
const DEFAULT_LAYOUT: LayoutState = { leftWidth: 260, rightWidth: 500, leftCollapsed: false, rightCollapsed: false };
const STORAGE_KEY = "deep-reader:three-pane-layout";

/** Resizable three-pane shell. Divider double-click/Enter toggles a side pane. */
export function ResizableThreePane({ left, center, right }: Props) {
  const [layout, setLayout] = useState<LayoutState>(readLayout);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); }, [layout]);
  const leftWidth = layout.leftCollapsed ? 0 : layout.leftWidth;
  const rightWidth = layout.rightCollapsed ? 0 : layout.rightWidth;

  return <main className="grid h-[calc(100vh-3.5rem)] overflow-hidden" style={{ gridTemplateColumns: `${leftWidth}px 6px minmax(420px,1fr) 6px ${rightWidth}px` }}>
    <div className={layout.leftCollapsed ? "hidden" : "min-w-0 overflow-hidden"}>{left}</div>
    <Divider side="left" collapsed={layout.leftCollapsed} width={layout.leftWidth} setLayout={setLayout} />
    <div className="min-w-0 overflow-hidden">{center}</div>
    <Divider side="right" collapsed={layout.rightCollapsed} width={layout.rightWidth} setLayout={setLayout} />
    <div className={layout.rightCollapsed ? "hidden" : "min-w-0 overflow-hidden"}>{right}</div>
  </main>;
}

function Divider({ side, collapsed, width, setLayout }: { side: "left" | "right"; collapsed: boolean; width: number; setLayout: React.Dispatch<React.SetStateAction<LayoutState>> }) {
  const resize = (event: PointerEvent<HTMLDivElement>) => {
    if (collapsed) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    const target = event.currentTarget;
    const onMove = (move: globalThis.PointerEvent) => {
      const delta = move.clientX - startX;
      const next = side === "left" ? startWidth + delta : startWidth - delta;
      setLayout((current) => ({ ...current, [side === "left" ? "leftWidth" : "rightWidth"]: clamp(next, side === "left" ? 200 : 340, side === "left" ? 420 : 760) }));
    };
    const onUp = () => { target.removeEventListener("pointermove", onMove); target.removeEventListener("pointerup", onUp); };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };
  const toggle = () => setLayout((current) => ({ ...current, [side === "left" ? "leftCollapsed" : "rightCollapsed"]: !collapsed }));
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") { event.preventDefault(); toggle(); return; }
    if (!collapsed && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 20 : -20;
      const signed = side === "left" ? delta : -delta;
      setLayout((current) => ({ ...current, [side === "left" ? "leftWidth" : "rightWidth"]: clamp(width + signed, side === "left" ? 200 : 340, side === "left" ? 420 : 760) }));
    }
  };
  return <div
    role="separator"
    tabIndex={0}
    aria-orientation="vertical"
    aria-label={`${side === "left" ? "左" : "右"}ペインの幅調整。Enterで折りたたみ`}
    title="ドラッグで幅変更・ダブルクリック/Enterで折りたたみ"
    className="group relative z-40 cursor-col-resize bg-slate-200 outline-none hover:bg-slate-300 focus:bg-slate-300"
    onPointerDown={resize}
    onDoubleClick={toggle}
    onKeyDown={keyboard}
  ><span className="absolute left-1/2 top-1/2 h-9 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-400/40 group-hover:bg-slate-500/60" /></div>;
}

function readLayout(): LayoutState {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const value = JSON.parse(raw) as Partial<LayoutState>;
    return {
      leftWidth: clamp(Number(value.leftWidth) || DEFAULT_LAYOUT.leftWidth, 200, 420),
      rightWidth: clamp(Number(value.rightWidth) || DEFAULT_LAYOUT.rightWidth, 340, 760),
      leftCollapsed: Boolean(value.leftCollapsed),
      rightCollapsed: Boolean(value.rightCollapsed),
    };
  } catch { return DEFAULT_LAYOUT; }
}
function clamp(value: number, min: number, max: number): number { return Math.min(Math.max(value, min), max); }
