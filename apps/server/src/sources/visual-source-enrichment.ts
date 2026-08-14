import type { CreateVisualSourceRequest, ResolveSelectionResponse } from "@lensmap/shared";
import type { VisualOcrService } from "./visual-ocr-service.js";

export interface VisualLocationResolver {
  resolveSelectionText(bookId: string, text: string): Promise<ResolveSelectionResponse>;
}

/**
 * Derive OCR and a conservative PDF page location without ever making image persistence depend on enrichment.
 * Rect resolution is intentionally not fabricated from OCR text boxes; it remains unresolved until image/layout alignment exists.
 */
export async function enrichVisualSourceMetadata(
  bookId: string,
  metadata: CreateVisualSourceRequest,
  png: Buffer,
  ocrService: VisualOcrService | undefined,
  locationResolver: VisualLocationResolver,
  onWarning?: (error: unknown) => void,
): Promise<CreateVisualSourceRequest> {
  if (!ocrService) return metadata;
  try {
    const ocr = await ocrService.recognize(png);
    if (!ocr?.text) return metadata;
    let enriched: CreateVisualSourceRequest = {
      ...metadata,
      recognizedText: ocr.text,
      ocrConfidence: ocr.confidence,
    };
    try {
      const resolution = await locationResolver.resolveSelectionText(bookId, ocr.text.slice(0, 100_000));
      const singlePageCandidates = resolution.candidates.filter((candidate) => candidate.pageStart === candidate.pageEnd);
      const pages = [...new Set(singlePageCandidates.map((candidate) => candidate.pageStart))];
      if (pages.length === 1) {
        const page = pages[0]!;
        const matching = singlePageCandidates.filter((candidate) => candidate.pageStart === page);
        enriched = {
          ...enriched,
          locationStatus: "page-resolved",
          page,
          locationConfidence: Math.min(
            ocr.confidence,
            matching.some((candidate) => candidate.confidence === "exact-page") ? 0.95 : 0.75,
          ),
          documentNodeIds: [...new Set(matching.flatMap((candidate) => candidate.documentNodeIds))],
        };
      }
    } catch (error: unknown) {
      onWarning?.(error);
    }
    return enriched;
  } catch (error: unknown) {
    onWarning?.(error);
    return metadata;
  }
}
