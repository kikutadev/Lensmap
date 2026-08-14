import { describe, expect, it } from "vitest";
import type { ResolveSelectionResponse } from "@lensmap/shared";
import { enrichVisualSourceMetadata, type VisualLocationResolver } from "./visual-source-enrichment.js";
import type { VisualOcrService } from "./visual-ocr-service.js";

const BASE_METADATA = {
  captureImageWidthPx: 1200,
  captureImageHeightPx: 800,
  captureRectNormalized: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
  locationStatus: "unresolved" as const,
  documentNodeIds: [],
};
const PNG = Buffer.from("png-fixture");

class FakeOcr implements VisualOcrService {
  public constructor(private readonly result: { text: string; confidence: number } | null, private readonly error?: Error) {}
  public async recognize(): Promise<{ text: string; confidence: number } | null> {
    if (this.error) throw this.error;
    return this.result;
  }
}

class FakeResolver implements VisualLocationResolver {
  public constructor(private readonly response: ResolveSelectionResponse, private readonly error?: Error) {}
  public async resolveSelectionText(): Promise<ResolveSelectionResponse> {
    if (this.error) throw this.error;
    return this.response;
  }
}

function resolution(pages: number[]): ResolveSelectionResponse {
  return {
    quoteNormalized: "diagram text",
    candidates: pages.map((page, index) => ({
      pageStart: page,
      pageEnd: page,
      quoteRaw: "diagram text",
      quoteNormalized: "diagram text",
      rects: [{ pageIndex: page, x: 10, y: 20, width: 100, height: 20 }],
      documentNodeIds: [`block-${page}-${index}`],
      confidence: "exact-page" as const,
    })),
  };
}

describe("enrichVisualSourceMetadata", () => {
  it("keeps the image source unresolved when OCR fails", async () => {
    const warnings: unknown[] = [];
    const result = await enrichVisualSourceMetadata(
      "book-1",
      BASE_METADATA,
      PNG,
      new FakeOcr(null, new Error("Vision unavailable")),
      new FakeResolver(resolution([3])),
      (error) => warnings.push(error),
    );

    expect(result).toEqual(BASE_METADATA);
    expect(warnings).toHaveLength(1);
  });

  it("stores OCR metadata and resolves a unique PDF page conservatively", async () => {
    const result = await enrichVisualSourceMetadata(
      "book-1",
      BASE_METADATA,
      PNG,
      new FakeOcr({ text: "diagram text", confidence: 0.91 }),
      new FakeResolver(resolution([6])),
    );

    expect(result).toMatchObject({
      recognizedText: "diagram text",
      ocrConfidence: 0.91,
      locationStatus: "page-resolved",
      page: 6,
      locationConfidence: 0.91,
      documentNodeIds: ["block-6-0"],
    });
    expect(result.pageRectNormalized).toBeUndefined();
  });

  it("keeps location unresolved when OCR text maps to multiple pages", async () => {
    const result = await enrichVisualSourceMetadata(
      "book-1",
      BASE_METADATA,
      PNG,
      new FakeOcr({ text: "common label", confidence: 0.87 }),
      new FakeResolver(resolution([2, 9])),
    );

    expect(result).toMatchObject({
      recognizedText: "common label",
      ocrConfidence: 0.87,
      locationStatus: "unresolved",
      documentNodeIds: [],
    });
    expect(result.page).toBeUndefined();
  });

  it("retains OCR text when PDF re-identification fails", async () => {
    const warnings: unknown[] = [];
    const result = await enrichVisualSourceMetadata(
      "book-1",
      BASE_METADATA,
      PNG,
      new FakeOcr({ text: "local OCR survives", confidence: 0.8 }),
      new FakeResolver(resolution([]), new Error("index unavailable")),
      (error) => warnings.push(error),
    );

    expect(result).toMatchObject({
      recognizedText: "local OCR survives",
      ocrConfidence: 0.8,
      locationStatus: "unresolved",
    });
    expect(warnings).toHaveLength(1);
  });
});
