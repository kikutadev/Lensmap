import { describe, expect, it } from "vitest";
import { normalizePdfText } from "./normalize.js";

describe("normalizePdfText", () => {
  it("joins line-break hyphenation and collapses PDF whitespace", () => {
    expect(normalizePdfText("Cloud-\nflare   Workers\n  Edge")).toBe("Cloudflare Workers Edge");
  });

  it("normalizes compatibility ligatures", () => {
    expect(normalizePdfText("oﬃce")).toBe("office");
  });
});
