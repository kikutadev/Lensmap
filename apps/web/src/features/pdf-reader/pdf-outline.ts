import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ReaderOutlineItem } from "../../store/reader-store";

/** Resolve PDF outline destinations to physical page numbers for the reader sidebar. */
export async function resolvePdfOutline(pdf: PDFDocumentProxy): Promise<ReaderOutlineItem[]> {
  const outline = await pdf.getOutline();
  if (!outline?.length) return [];
  const resolved: ReaderOutlineItem[] = [];
  let sequence = 0;

  const visit = async (items: typeof outline, depth: number): Promise<void> => {
    for (const item of items) {
      const page = await resolveOutlinePage(pdf, item.dest).catch(() => null);
      if (page !== null) {
        resolved.push({ id: `outline-${sequence++}`, title: item.title || `PDF ${page}`, page, depth });
      }
      if (item.items?.length) await visit(item.items, depth + 1);
    }
  };

  await visit(outline, 0);
  return resolved;
}

async function resolveOutlinePage(pdf: PDFDocumentProxy, destination: unknown): Promise<number | null> {
  let dest = destination;
  if (typeof dest === "string") dest = await pdf.getDestination(dest);
  if (!Array.isArray(dest) || !dest[0]) return null;
  const getPageIndex = (pdf as unknown as { getPageIndex(ref: unknown): Promise<number> }).getPageIndex.bind(pdf);
  return (await getPageIndex(dest[0])) + 1;
}
