import type { NormalizedRect } from "@lensmap/shared";

export interface Point { x: number; y: number; }
export interface DisplayBounds { left: number; top: number; width: number; height: number; }
export interface PixelCrop { x: number; y: number; width: number; height: number; }

/** Convert a pointer drag over a rendered screenshot into a stable 0..1 image-relative rectangle. */
export function dragToNormalizedRect(start: Point, end: Point, bounds: DisplayBounds): NormalizedRect | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const left = clamp(Math.min(start.x, end.x), bounds.left, bounds.left + bounds.width);
  const right = clamp(Math.max(start.x, end.x), bounds.left, bounds.left + bounds.width);
  const top = clamp(Math.min(start.y, end.y), bounds.top, bounds.top + bounds.height);
  const bottom = clamp(Math.max(start.y, end.y), bounds.top, bounds.top + bounds.height);
  const width = right - left;
  const height = bottom - top;
  if (width < 2 || height < 2) return null;
  return {
    x: clamp01((left - bounds.left) / bounds.width),
    y: clamp01((top - bounds.top) / bounds.height),
    width: clamp01(width / bounds.width),
    height: clamp01(height / bounds.height),
  };
}

/** Map a normalized crop to source-image pixels without depending on DPR or rendered screenshot scale. */
export function normalizedRectToPixelCrop(rect: NormalizedRect, imageWidth: number, imageHeight: number): PixelCrop {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    throw new Error("Invalid capture image dimensions");
  }
  const x1 = stableFloor(clamp01(rect.x) * imageWidth);
  const y1 = stableFloor(clamp01(rect.y) * imageHeight);
  const x2 = stableCeil(clamp01(rect.x + rect.width) * imageWidth);
  const y2 = stableCeil(clamp01(rect.y + rect.height) * imageHeight);
  return {
    x: Math.min(imageWidth - 1, Math.max(0, x1)),
    y: Math.min(imageHeight - 1, Math.max(0, y1)),
    width: Math.max(1, Math.min(imageWidth, x2) - Math.min(imageWidth - 1, Math.max(0, x1))),
    height: Math.max(1, Math.min(imageHeight, y2) - Math.min(imageHeight - 1, Math.max(0, y1))),
  };
}

function stableFloor(value: number): number { return Math.floor(value + 1e-9); }
function stableCeil(value: number): number { return Math.ceil(value - 1e-9); }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function clamp01(value: number): number { return clamp(value, 0, 1); }
