import { describe, expect, it } from "vitest";
import { findInvalidCitationLabels } from "./citation-validator.js";

describe("findInvalidCitationLabels", () => {
  it("returns only unknown unique source labels", () => {
    expect(findInvalidCitationLabels("説明 [S1][S9]。続き [S9]。", ["S1", "S2"]))
      .toEqual(["S9"]);
  });
});
