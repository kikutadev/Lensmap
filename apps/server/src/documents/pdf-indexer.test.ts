import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parsePdfForIndex } from "./pdf-indexer.js";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("parsePdfForIndex", () => {
  it("extracts searchable text and conservative blocks from a text PDF", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "lensmap-pdf-indexer-"));
    const path = join(tempDir, "sample.pdf");
    writeFileSync(path, buildSinglePagePdf("BT\n/F1 18 Tf\n72 720 Td\n(Architecture) Tj\n0 -32 Td\n/F1 12 Tf\n(Dependency inversion separates policy from implementation.) Tj\nET"));
    const parsed = await parsePdfForIndex("book-1", path);
    expect(parsed.pageCount).toBe(1);
    expect(parsed.pages[0]?.textNormalized).toContain("Dependency inversion");
    expect(parsed.blocks.some((block) => block.textNormalized.includes("Dependency inversion"))).toBe(true);
    expect(parsed.blocks.every((block) => block.rects.every((rect) => rect.pageIndex === 0))).toBe(true);
  });

  it("reconstructs two-column reading order from coordinates instead of content-stream order", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "lensmap-pdf-indexer-columns-"));
    const path = join(tempDir, "columns.pdf");
    const content = [
      "BT", "/F1 12 Tf", "330 700 Td", "(Right column first) Tj", "0 -24 Td", "(Right column second) Tj", "ET",
      "BT", "/F1 12 Tf", "72 700 Td", "(Left column first) Tj", "0 -24 Td", "(Left column second) Tj", "ET",
    ].join("\n");
    writeFileSync(path, buildSinglePagePdf(content));
    const parsed = await parsePdfForIndex("book-columns", path);
    const text = parsed.pages[0]?.textRaw ?? "";
    expect(text.indexOf("Left column first")).toBeLessThan(text.indexOf("Right column first"));
    expect(text.indexOf("Left column second")).toBeLessThan(text.indexOf("Right column first"));
  });

  it("removes repeated header/footer text from semantic content while retaining page body", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "lensmap-pdf-indexer-margins-"));
    const path = join(tempDir, "margins.pdf");
    writeFileSync(path, buildTwoPagePdf(
      marginPage("First page body explains dependency boundaries."),
      marginPage("Second page body explains adapter boundaries."),
    ));
    const parsed = await parsePdfForIndex("book-margins", path);
    const combined = parsed.pages.map((page) => page.textNormalized).join(" ");
    expect(combined).not.toContain("Technical Book Header");
    expect(combined).not.toContain("Internal Footer");
    expect(combined).toContain("First page body");
    expect(combined).toContain("Second page body");
  });
});

function marginPage(body: string): string {
  return [
    "BT", "/F1 8 Tf", "72 770 Td", "(Technical Book Header) Tj", "ET",
    "BT", "/F1 12 Tf", "72 700 Td", `(${body}) Tj`, "ET",
    "BT", "/F1 8 Tf", "72 35 Td", "(Internal Footer) Tj", "ET",
  ].join("\n");
}

function buildSinglePagePdf(content: string): Buffer {
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    stream(content),
  ]);
}

function buildTwoPagePdf(first: string, second: string): Buffer {
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    stream(first),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 7 0 R >>",
    stream(second),
  ]);
}

function stream(content: string): string {
  return `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
}

function buildPdf(objects: string[]): Buffer {
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}
