import { describe, expect, it } from "vitest";
import { visualCaptureOptionalOrigin } from "./visual-capture-permission";

describe("visualCaptureOptionalOrigin", () => {
  it("uses a just-in-time <all_urls> grant required by captureVisibleTab from Side Panel", () => {
    expect(visualCaptureOptionalOrigin()).toBe("<all_urls>");
  });
});
