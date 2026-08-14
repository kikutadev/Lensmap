export interface PageLabelLike {
  pageStart: number;
  pageEnd: number;
  printedPageLabelStart?: string | null | undefined;
  printedPageLabelEnd?: string | null | undefined;
}

/** Prefer the book's printed page label while retaining the physical PDF page when they differ. */
export function formatSourcePage(source: PageLabelLike): string {
  const pdfStart = source.pageStart + 1;
  const pdfEnd = source.pageEnd + 1;
  const printedStart = source.printedPageLabelStart?.trim();
  const printedEnd = source.printedPageLabelEnd?.trim();

  if (printedStart) {
    const printedRange = printedEnd && printedEnd !== printedStart
      ? `${printedStart}–${printedEnd}`
      : printedStart;
    const pdfRange = pdfEnd !== pdfStart ? `${pdfStart}–${pdfEnd}` : String(pdfStart);
    if (printedRange !== pdfRange) return `p.${printedRange} · PDF ${pdfRange}`;
    return `p.${printedRange}`;
  }

  return pdfEnd !== pdfStart ? `PDF p.${pdfStart}–${pdfEnd}` : `PDF p.${pdfStart}`;
}
