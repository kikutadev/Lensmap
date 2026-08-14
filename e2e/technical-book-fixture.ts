import { writeFileSync } from "node:fs";

const pages = [
  [
    "Chapter 1 - Fast Path",
    "The Fast Path accepts requests at the edge and reuses local cache entries when safe.",
    "Remote cache invalidation is delegated to BlueGate, which is defined later in this book.",
    "The request path remains available while invalidation intents are coordinated asynchronously.",
  ],
  [
    "Chapter 2 - Local Caches",
    "Local caches reduce origin load and keep hot reads close to callers.",
    "A cache entry may be reused only while its observed invalidation epoch is current.",
    "Local eviction is intentionally independent from remote coordination.",
  ],
  [
    "Chapter 3 - BlueGate",
    "BlueGate is a consistency coordinator for remote cache invalidation.",
    "It serializes invalidation epochs across edge regions and records the committed epoch.",
    "The Fast Path submits invalidation intents to BlueGate before stale entries can be reused.",
    "Readers compare their observed epoch with the committed epoch before serving cached data.",
  ],
  [
    "Chapter 4 - Failure Modes",
    "During coordinator loss, the Fast Path may continue safe reads whose epochs are already current.",
    "New remote invalidations wait until BlueGate can commit a new epoch.",
    "This separation keeps the read path resilient without weakening consistency.",
  ],
];

/** Write a deterministic, text-selectable multi-page technical-book PDF fixture. */
export function writeTechnicalBookFixture(path: string): void {
  writeFileSync(path, createTechnicalBookPdf(pages));
}

/** Write a long deterministic PDF used to prove that reader rendering stays bounded. */
export function writeLongTechnicalBookFixture(path: string, pageCount = 120): void {
  const longPages = Array.from({ length: pageCount }, (_, index) => [
    `Chapter ${index + 1} - Virtualized Page`,
    `This is technical reader page ${index + 1} of ${pageCount}.`,
    `The page exists to verify bounded Canvas and TextLayer retention during long-book navigation.`,
  ]);
  writeFileSync(path, createTechnicalBookPdf(longPages));
}

function createTechnicalBookPdf(pageLines: string[][]): Buffer {
  const pageObjectNumbers = pageLines.map((_, index) => 4 + index * 2);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pageLines.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  for (let pageIndex = 0; pageIndex < pageLines.length; pageIndex += 1) {
    const contentObjectNumber = 5 + pageIndex * 2;
    const content = renderPageContent(pageLines[pageIndex] ?? []);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content, "binary")} >>\nstream\n${content}\nendstream`,
    );
  }

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "binary"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

function renderPageContent(lines: string[]): string {
  const commands = ["BT", "/F1 18 Tf", "72 720 Td"];
  lines.forEach((line, index) => {
    if (index > 0) {
      commands.push("0 -36 Td", index === 1 ? "/F1 12 Tf" : "/F1 12 Tf");
    }
    commands.push(`(${escapePdfText(line)}) Tj`);
  });
  commands.push("ET");
  return commands.join("\n");
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
