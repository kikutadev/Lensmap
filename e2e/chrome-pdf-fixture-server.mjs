import { createServer } from "node:http";

const books = {
  "/book.pdf": createPdf([
    ["Chapter 1 - Fast Path", "Remote cache invalidation is delegated to BlueGate, which is defined later in this book."],
    ["Chapter 2 - Local Cache", "Local caches reduce origin load and keep hot reads close to callers."],
    ["Chapter 3 - BlueGate", "BlueGate is a consistency coordinator for remote cache invalidation."],
  ]),
  "/duplicate.pdf": createPdf([
    ["Chapter A - First occurrence", "Shared statement appears in two chapters."],
    ["Chapter B - Second occurrence", "Shared statement appears in two chapters."],
    ["Chapter C - Unique", "Only the third chapter has this unique sentence."],
  ]),
  "/auth/book.pdf": createPdf([
    ["Authenticated Chapter", "Authenticated PDF content remains readable through the Deep Reader extension."],
    ["Authenticated Details", "The browser cookie is required when the extension refetches this PDF."],
  ]),
};

const port = Number.parseInt(process.env.DEEP_READER_PDF_PORT ?? "9876", 10);

createServer((req, res) => {
  if (!req.url) return writeText(res, 400, "Missing URL");
  const url = new URL(req.url, `http://${req.headers.host ?? `127.0.0.1:${port}`}`);

  if (url.pathname === "/auth/login") {
    res.writeHead(302, {
      location: "/auth/book.pdf",
      "set-cookie": "deep_reader_auth=ok; Path=/auth; HttpOnly; SameSite=Lax",
      "cache-control": "no-store",
    });
    res.end();
    return;
  }

  if (url.pathname === "/auth/book.pdf" && !String(req.headers.cookie ?? "").includes("deep_reader_auth=ok")) {
    writeText(res, 401, "Authentication required");
    return;
  }

  const pdf = books[url.pathname];
  if (pdf) {
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-length": pdf.length,
      "cache-control": "no-store",
    });
    res.end(pdf);
    return;
  }

  if (url.pathname === "/health") {
    writeText(res, 200, "ok");
    return;
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(`<ul>
    <li><a href="/book.pdf">book.pdf</a></li>
    <li><a href="/duplicate.pdf">duplicate.pdf</a></li>
    <li><a href="/auth/login">authenticated book.pdf</a></li>
  </ul>`);
}).listen(port, "127.0.0.1", () => console.log(`Chrome PDF fixture server http://127.0.0.1:${port}`));

function writeText(res, status, body) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function createPdf(pages) {
  const pageObjectNumbers = pages.map((_, index) => 4 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const contentObjectNumber = 5 + pageIndex * 2;
    const content = renderPageContent(pages[pageIndex]);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content, "binary")} >>\nstream\n${content}\nendstream`,
    );
  }
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "binary"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, "binary");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "binary");
}

function renderPageContent(lines) {
  const commands = ["BT", "/F1 18 Tf", "72 720 Td"];
  lines.forEach((line, index) => {
    if (index > 0) commands.push("0 -40 Td", "/F1 12 Tf");
    commands.push(`(${escapePdfText(line)}) Tj`);
  });
  commands.push("ET");
  return commands.join("\n");
}

function escapePdfText(value) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
