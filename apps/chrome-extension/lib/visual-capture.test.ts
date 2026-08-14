import { describe, expect, it } from "vitest";
import { dragToNormalizedRect, normalizedRectToPixelCrop } from "./visual-capture";

describe("visual capture geometry", () => {
  it("normalizes a reversed drag against the rendered screenshot bounds", () => {
    expect(dragToNormalizedRect(
      { x: 900, y: 700 },
      { x: 300, y: 250 },
      { left: 100, top: 100, width: 1000, height: 800 },
    )).toEqual({ x: 0.2, y: 0.1875, width: 0.6, height: 0.5625 });
  });

  it("maps the same normalized region to source pixels regardless of display scale", () => {
    const rect = { x: 0.25, y: 0.2, width: 0.5, height: 0.4 };
    expect(normalizedRectToPixelCrop(rect, 2000, 1000)).toEqual({ x: 500, y: 200, width: 1000, height: 400 });
  });

  it("clamps pointer drags and crop rectangles to image bounds", () => {
    const rect = dragToNormalizedRect(
      { x: -50, y: -50 },
      { x: 1200, y: 900 },
      { left: 0, top: 0, width: 1000, height: 800 },
    );
    expect(rect).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(normalizedRectToPixelCrop(rect!, 1440, 900)).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
  });
});
