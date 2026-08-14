import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import puppeteer from "puppeteer";
import { extensionLaunchOptions } from "./chrome-launch.mjs";

const root = process.cwd();
const pdfPaths = process.argv.slice(2).map((value) => resolve(root, value));
if (pdfPaths.length === 0) {
  console.error("Usage: node e2e/chrome-extension-real-pdf-smoke.mjs <pdf> [pdf...]");
  process.exit(2);
}

const extensionPath = resolve(root, "apps/chrome-extension/.output/chrome-mv3");
const dataDir = resolve(root, ".extension-real-pdf-data");
const migrationsDir = resolve(root, "apps/server/drizzle");
const serverPort = 4517;
const serverBase = `http://127.0.0.1:${serverPort}/api`;
const nodeBin = process.env.DEEP_READER_SERVER_NODE ?? process.execPath;
rmSync(dataDir, { recursive: true, force: true });

const server = spawn(nodeBin, ["apps/server/dist/index.js"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    DEEP_READER_DATA_DIR: dataDir,
    DEEP_READER_MIGRATIONS_DIR: migrationsDir,
    DEEP_READER_HOST: "127.0.0.1",
    DEEP_READER_PORT: String(serverPort),
    CODEX_BIN: process.env.CODEX_BIN ?? "/Applications/ChatGPT.app/Contents/Resources/codex",
  },
});
let browser;

try {
  await waitForHttp(`${serverBase}/health`, 30_000);
  browser = await puppeteer.launch(extensionLaunchOptions(extensionPath));
  const workerTarget = await browser.waitForTarget((target) => target.type() === "service_worker" && target.url().endsWith("background.js"), { timeout: 20_000 });
  const worker = await workerTarget.worker();
  assert(worker);
  const extensionId = new URL(workerTarget.url()).host;
  await worker.evaluate(async (base) => chrome.storage.local.set({ deepReaderServerBase: base }), serverBase);
  assert.equal(await worker.evaluate(() => chrome.extension.isAllowedFileSchemeAccess()), true);
  const probe = await browser.newPage();
  await probe.goto(`chrome-extension://${extensionId}/probe.html`);

  const results = [];
  for (const pdfPath of pdfPaths) {
    const imported = await importAndIndex(pdfPath);
    const sample = await findUniqueParagraph(imported.id, imported.pageCount);
    assert(sample, `No suitable paragraph found in ${pdfPath}`);

    const page = await browser.newPage();
    const fileUrl = pathToFileURL(pdfPath).toString();
    await page.goto(fileUrl, { waitUntil: "load", timeout: 60_000 });
    await page.bringToFront();
    await wait(700);
    assert(browser.targets().some((target) => target.url().includes("mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html")), "Built-in PDF viewer did not load");
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id ?? null);
    assert.notEqual(tabId, null);

    let capture = await probe.evaluate(async ({ selectionText, pageUrl, tabId }) => chrome.runtime.sendMessage({
      type: "probe-capture-selection",
      payload: { selectionText, pageUrl, tabId },
    }), { selectionText: sample.textRaw, pageUrl: fileUrl, tabId });
    assert.equal(capture?.ok, true, capture?.error ?? `Capture failed for ${pdfPath}`);

    if (capture.state?.status === "ambiguous") {
      const candidateIndex = capture.state.resolutionCandidates.findIndex((candidate) => candidate.pageStart === sample.pageIndex);
      assert(candidateIndex >= 0, `Expected page ${sample.pageIndex + 1} missing from ambiguity candidates`);
      const resolved = await probe.evaluate(async ({ tabId, candidateIndex }) => chrome.runtime.sendMessage({ type: "resolve-selection-candidate", tabId, candidateIndex }), { tabId, candidateIndex });
      assert.equal(resolved?.ok, true, resolved?.error ?? "Ambiguous candidate materialization failed");
      capture = resolved;
    }

    assert.equal(capture.state?.status, "ready");
    const source = capture.state?.sources?.at(-1);
    assert(source, "Resolved SourceAnchor was missing");
    assert.equal(source.pageStart, sample.pageIndex, `${basename(pdfPath)} resolved to wrong PDF page`);
    assert(source.documentNodeIds.includes(sample.id), `${basename(pdfPath)} did not recover the original DocumentBlock`);

    results.push({
      file: basename(pdfPath),
      pages: imported.pageCount,
      blocks: imported.blockCount,
      sampledPage: sample.pageIndex + 1,
      sampleLength: sample.textRaw.length,
      resolution: capture.state.status,
    });
    await page.close();
  }

  console.log(JSON.stringify({ extensionId, realPdfCount: results.length, results }, null, 2));
} finally {
  await browser?.close().catch(() => undefined);
  if (server.exitCode === null) server.kill("SIGTERM");
  rmSync(dataDir, { recursive: true, force: true });
}

async function importAndIndex(pdfPath) {
  const form = new FormData();
  form.append("file", new File([readFileSync(pdfPath)], basename(pdfPath), { type: "application/pdf" }));
  const importResponse = await fetch(`${serverBase}/books/import`, { method: "POST", body: form });
  if (!importResponse.ok) throw new Error(await importResponse.text());
  const book = await importResponse.json();
  const indexResponse = await fetch(`${serverBase}/books/${book.id}/document/index`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: false }) });
  if (!indexResponse.ok) throw new Error(await indexResponse.text());
  const status = await indexResponse.json();
  assert.equal(status.status, "indexed");
  return { id: book.id, pageCount: status.pageCount, blockCount: status.blockCount };
}

async function findUniqueParagraph(bookId, pageCount) {
  for (let pageIndex = 2; pageIndex < Math.min(pageCount, 40); pageIndex += 1) {
    const response = await fetch(`${serverBase}/books/${bookId}/document/pages/${pageIndex}/blocks`);
    assert(response.ok);
    const blocks = await response.json();
    for (const block of blocks) {
      if (block.kind !== "paragraph" || block.textRaw.length < 80 || block.textRaw.length > 500) continue;
      const resolution = await fetch(`${serverBase}/books/${bookId}/sources/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteRaw: block.textRaw }) });
      if (!resolution.ok) continue;
      const data = await resolution.json();
      if (data.candidates.length === 1 && data.candidates[0].pageStart === pageIndex) return block;
    }
  }
  return null;
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url}: HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await wait(150);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}
function wait(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
