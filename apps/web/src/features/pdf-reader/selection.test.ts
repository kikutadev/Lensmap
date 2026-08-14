import { describe, expect, it } from "vitest";
import { normalizePdfText } from "@deep-reader/shared";

describe("selection normalization", () => {
  it("uses the shared PDF normalizer for AI context", () => {
    expect(normalizePdfText("Cloud-\nflare Workers")).toBe("Cloudflare Workers");
  });
});
