import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import puppeteer from "puppeteer";
import { extensionLaunchOptions } from "./chrome-launch.mjs";

const root = process.cwd();
const extensionPath = resolve(root, "apps/chrome-extension/.output/chrome-mv3");
const dataDir = resolve(root, ".extension-e2e-data");
const migrationsDir = resolve(root, "apps/server/drizzle");
const localPdfPath = resolve(root, ".extension-e2e-local.pdf");
const nodeBin = process.env.DEEP_READER_SERVER_NODE ?? process.execPath;
const serverPort = 4417;
const pdfPort = 9976;
const serverBase = `http://127.0.0.1:${serverPort}/api`;
const pdfUrl = `http://127.0.0.1:${pdfPort}/book.pdf`;
const duplicatePdfUrl = `http://127.0.0.1:${pdfPort}/duplicate.pdf`;
const authenticatedLoginUrl = `http://127.0.0.1:${pdfPort}/auth/login`;
const authenticatedPdfUrl = `http://127.0.0.1:${pdfPort}/auth/book.pdf`;
const selectedSentence = "Remote cache invalidation is delegated to BlueGate, which is defined later in this book.";
const question = "この抜粋だけではBlueGateの定義がありません。本書内を追加参照してBlueGateの定義を日本語で説明してください。書籍本文に基づく説明には必ずSource IDを付けてください。";

rmSync(dataDir, { recursive: true, force: true });
rmSync(localPdfPath, { force: true });
const children = [];
let browser;

try {
  children.push(spawn(nodeBin, ["e2e/chrome-pdf-fixture-server.mjs"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DEEP_READER_PDF_PORT: String(pdfPort) },
  }));
  children.push(spawn(nodeBin, ["apps/server/dist/index.js"], {
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
  }));
  for (const child of children) attachChildDiagnostics(child);

  await waitForHttp(`${serverBase}/health`, 30_000);
  await waitForHttp(pdfUrl, 15_000);
  const codexStatus = await jsonFetch(`${serverBase}/codex/status`);
  assert.equal(codexStatus.ready, true, codexStatus.error ?? "Codex app-server is not ready");
  assert.equal(codexStatus.account?.type, "chatgpt", "Live E2E requires ChatGPT-authenticated Codex");

  browser = await puppeteer.launch(extensionLaunchOptions(extensionPath));

  const workerTarget = await browser.waitForTarget(
    (target) => target.type() === "service_worker" && target.url().endsWith("background.js"),
    { timeout: 20_000 },
  );
  const worker = await workerTarget.worker();
  assert(worker, "Extension service worker was not created");
  const extensionId = new URL(workerTarget.url()).host;
  await worker.evaluate(async (configuredServerBase) => {
    await chrome.storage.local.set({ deepReaderServerBase: configuredServerBase });
    let lastError = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        await Promise.all([
          chrome.contextMenus.update("deep-reader-dive", { visible: true }),
          chrome.contextMenus.update("deep-reader-add", { visible: true }),
        ]);
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw lastError ?? new Error("Context menus were not registered");
  }, serverBase);

  const pdfPage = await browser.newPage();
  await pdfPage.goto(pdfUrl);
  await wait(900);
  assert(
    browser.targets().some((target) => target.url().includes("mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html")),
    "Chrome built-in PDF viewer did not load",
  );

  const selectedText = await selectAllViewerText(browser, selectedSentence);
  assert(selectedText.includes(selectedSentence), "Chrome PDF viewer selection did not contain the expected page-1 text");
  assert(selectedText.includes("BlueGate is a consistency coordinator"), "Chrome PDF viewer selection did not include later PDF pages");

  await pdfPage.bringToFront();
  const pdfTabId = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  });
  assert.notEqual(pdfTabId, null, "Could not resolve the PDF tab id");

  const probePage = await browser.newPage();
  await probePage.goto(`chrome-extension://${extensionId}/probe.html`);
  await probePage.click("#open");
  const sideTarget = await browser.waitForTarget(
    (target) => target.url() === `chrome-extension://${extensionId}/sidepanel.html`,
    { timeout: 10_000 },
  );
  const sidePanel = await sideTarget.asPage();
  assert(sidePanel, "Chrome Side Panel target could not be controlled");
  await pdfPage.bringToFront();
  await wait(250);

  const captureResult = await probePage.evaluate(async ({ selectionText, pageUrl, tabId }) =>
    chrome.runtime.sendMessage({
      type: "probe-capture-selection",
      payload: { selectionText, pageUrl, tabId },
    }), {
    selectionText: selectedSentence,
    pageUrl: pdfUrl,
    tabId: pdfTabId,
  });
  assert.equal(captureResult?.ok, true, captureResult?.error ?? "Selection pipeline failed");
  assert.equal(captureResult.state?.status, "ready");
  assert.equal(captureResult.state?.sources?.length, 1);
  assert.equal(captureResult.state.sources[0].pageStart, 0, "Selection did not resolve back to PDF page 1");
  assert(captureResult.state.sources[0].documentNodeIds.length > 0, "Selection did not resolve to a semantic document block");
  assert(captureResult.state.sources[0].rects.length > 0, "Selection did not recover PDF-coordinate rectangles");

  await sidePanel.waitForSelector(".source-card", { timeout: 30_000 });
  const sourceDisplay = await sidePanel.$eval(".source-card", (element) => element.textContent ?? "");
  assert(sourceDisplay.includes("PDF p.1"));
  assert(sourceDisplay.includes("Remote cache invalidation"));

  const questionSelector = 'textarea[aria-label="質問"]';
  await sidePanel.click(questionSelector);
  await sidePanel.type(questionSelector, question);
  await sidePanel.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "送信");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Send button not found");
    button.click();
  });
  await sidePanel.waitForFunction(
    () => [...document.querySelectorAll(".citation-row button")].some((button) => button.textContent?.includes("PDF p.3")),
    { timeout: 180_000 },
  );
  const answer = await sidePanel.$eval(".message.assistant:last-of-type .message-content", (element) => element.textContent ?? "");
  assert(answer.length > 30, "Codex answer was empty");
  await sidePanel.waitForSelector(".retrieval-audit", { timeout: 30_000 });

  const state = await readTabState(worker, pdfTabId);
  const chat = await jsonFetch(`${serverBase}/books/${state.bookId}/chat`);
  const assistant = [...(chat.thread?.messages ?? [])].reverse().find((message) => message.role === "assistant");
  assert.equal(assistant?.status, "completed");
  assert((assistant?.retrievalEvents?.length ?? 0) > 0, "Codex did not perform progressive book retrieval");
  const pageThreeSource = assistant?.sources?.find(
    (source) => source.origin === "ai-expansion" && source.pageStart === 2 && assistant.content.includes(`[${source.label}]`),
  );
  assert(pageThreeSource, "Codex did not cite an AI-expanded source from PDF page 3");

  await sidePanel.evaluate(() => {
    const button = [...document.querySelectorAll(".citation-row button")]
      .find((candidate) => candidate.textContent?.includes("PDF p.3"));
    if (!(button instanceof HTMLButtonElement)) throw new Error("PDF p.3 citation button not found");
    button.click();
  });
  await wait(1200);
  assert.equal(pdfPage.url(), `${pdfUrl}#page=3`, "Citation did not update the PDF URL fragment");
  assert.equal(String(await readViewerCurrentPage(browser, "3")), "3", "Built-in PDF viewer did not navigate to PDF page 3");

  await sidePanel.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("回答をInsightに保存"));
    if (!(button instanceof HTMLButtonElement)) throw new Error("Insight save button not found");
    button.click();
  });
  await sidePanel.waitForFunction(
    () => [...document.querySelectorAll("button")].some((button) => button.textContent?.includes("Insight保存済み")),
    { timeout: 30_000 },
  );
  const insights = await jsonFetch(`${serverBase}/insights?bookId=${state.bookId}`);
  assert((insights.artifacts?.length ?? 0) > 0, "Insight was not persisted from the extension Side Panel");

  // Extension Insight UI supports editing into immutable v2 and exposes the version diff.
  await sidePanel.evaluate(() => {
    const button = [...document.querySelectorAll(".view-tabs button")].find((candidate) => candidate.textContent?.includes("Insights"));
    if (!(button instanceof HTMLButtonElement)) throw new Error("Insights tab not found");
    button.click();
  });
  await sidePanel.waitForSelector(".insight-list-item", { timeout: 30_000 });
  await sidePanel.click(".insight-list-item");
  await sidePanel.waitForSelector(".insight-detail", { timeout: 30_000 });
  await sidePanel.evaluate(() => {
    const button = [...document.querySelectorAll(".insight-toolbar button")].find((candidate) => candidate.textContent?.includes("編集"));
    if (!(button instanceof HTMLButtonElement)) throw new Error("Insight edit button not found");
    button.click();
  });
  await sidePanel.waitForSelector(".insight-editor textarea");
  const firstDraft = await sidePanel.$eval(".insight-editor textarea", (element) => element.value);
  await sidePanel.$eval(".insight-editor textarea", (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, `${firstDraft}\n\nユーザー編集メモ`);
  await sidePanel.evaluate(() => {
    const button = [...document.querySelectorAll(".editor-actions button")].find((candidate) => candidate.textContent?.includes("新しいversionとして保存"));
    if (!(button instanceof HTMLButtonElement)) throw new Error("Insight version save button not found");
    button.click();
  });
  await sidePanel.waitForFunction(() => document.querySelector(".insight-meta")?.textContent?.includes("v2"), { timeout: 30_000 });
  await sidePanel.waitForSelector(".diff-panel", { timeout: 30_000 });
  const insightV2 = await jsonFetch(`${serverBase}/insights/${insights.artifacts[0].id}`);
  assert.equal(insightV2.artifact.version, 2, "Extension Insight edit did not create v2");

  // Multiple Deep Dive chats can be created and switched independently within the PDF tab.
  await sidePanel.evaluate(() => {
    const button = [...document.querySelectorAll(".view-tabs button")].find((candidate) => candidate.textContent?.includes("Chat"));
    if (!(button instanceof HTMLButtonElement)) throw new Error("Chat tab not found");
    button.click();
  });
  await sidePanel.waitForSelector("select[aria-label='Deep Dive chat']");
  const firstThreadId = state.threadId;
  await sidePanel.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.getAttribute("aria-label") === "新しいDeep Dive");
    if (!(button instanceof HTMLButtonElement)) throw new Error("New Deep Dive button not found");
    button.click();
  });
  await sidePanel.waitForFunction(() => document.querySelectorAll("select[aria-label='Deep Dive chat'] option").length >= 2, { timeout: 30_000 });
  const stateAfterNewChat = await readTabState(worker, pdfTabId);
  assert.notEqual(stateAfterNewChat.threadId, firstThreadId, "New Deep Dive did not switch thread");

  // Local file:// PDFs use the same pipeline when the user has enabled Chrome's file-URL access toggle.
  const localPdfBytes = Buffer.from(await (await fetch(pdfUrl)).arrayBuffer());
  writeFileSync(localPdfPath, localPdfBytes);
  const localPdfUrl = pathToFileURL(localPdfPath).toString();
  const localPdfPage = await browser.newPage();
  await localPdfPage.goto(localPdfUrl);
  await localPdfPage.bringToFront();
  await wait(700);
  const fileAccessAllowed = await worker.evaluate(() => chrome.extension.isAllowedFileSchemeAccess());
  assert.equal(fileAccessAllowed, true, "File-scheme access test switch did not enable extension file access");
  const localPdfTabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id ?? null);
  const localCapture = await probePage.evaluate(async ({ selectionText, pageUrl, tabId }) =>
    chrome.runtime.sendMessage({ type: "probe-capture-selection", payload: { selectionText, pageUrl, tabId } }),
  { selectionText: selectedSentence, pageUrl: localPdfUrl, tabId: localPdfTabId });
  assert.equal(localCapture?.ok, true, localCapture?.error ?? "Local file selection pipeline failed");
  assert.equal(localCapture.state?.sources?.[0]?.pageStart, 0, "Local PDF selection did not resolve to page 1");

  // Duplicate text stays ambiguous until the reader picks the occurrence, and tab state remains isolated.
  const duplicatePage = await browser.newPage();
  await duplicatePage.goto(duplicatePdfUrl);
  await duplicatePage.bringToFront();
  await wait(600);
  const duplicateTabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id ?? null);
  assert.notEqual(duplicateTabId, null);
  const duplicateCapture = await probePage.evaluate(async ({ selectionText, pageUrl, tabId }) =>
    chrome.runtime.sendMessage({ type: "probe-capture-selection", payload: { selectionText, pageUrl, tabId } }),
  { selectionText: "Shared statement appears in two chapters.", pageUrl: duplicatePdfUrl, tabId: duplicateTabId });
  assert.equal(duplicateCapture?.ok, true, duplicateCapture?.error ?? "Duplicate selection resolution failed");
  assert.equal(duplicateCapture.state?.status, "ambiguous");
  assert.equal(duplicateCapture.state?.resolutionCandidates?.length, 2);
  await sidePanel.waitForFunction(() => document.body.textContent?.includes("引用箇所を選択"), { timeout: 30_000 });
  await sidePanel.evaluate(() => {
    const candidate = [...document.querySelectorAll(".candidate-list button")].find((button) => button.textContent?.includes("PDF p.2"));
    if (!(candidate instanceof HTMLButtonElement)) throw new Error("PDF p.2 ambiguity candidate not found");
    candidate.click();
  });
  await sidePanel.waitForFunction(() => document.querySelector(".source-card")?.textContent?.includes("PDF p.2"), { timeout: 30_000 });
  const isolatedStates = {
    first: await readTabState(worker, pdfTabId),
    second: await readTabState(worker, duplicateTabId),
  };
  assert.equal(isolatedStates.first?.sources?.[0]?.pageStart, 0, "First PDF tab state was overwritten");
  assert.equal(isolatedStates.second?.sources?.[0]?.pageStart, 1, "Ambiguous second occurrence was not materialized on page 2");

  // Cookie-authenticated PDF can be refetched by the extension with the browser session.
  const authPage = await browser.newPage();
  await authPage.goto(authenticatedLoginUrl, { waitUntil: "networkidle0" });
  assert.equal(authPage.url(), authenticatedPdfUrl);
  await authPage.bringToFront();
  await wait(500);
  const authTabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id ?? null);
  const authCapture = await probePage.evaluate(async ({ selectionText, pageUrl, tabId }) =>
    chrome.runtime.sendMessage({ type: "probe-capture-selection", payload: { selectionText, pageUrl, tabId } }),
  { selectionText: "Authenticated PDF content remains readable through the Deep Reader extension.", pageUrl: authenticatedPdfUrl, tabId: authTabId });
  assert.equal(authCapture?.ok, true, authCapture?.error ?? "Authenticated PDF refetch failed");
  assert.equal(authCapture.state?.sources?.[0]?.pageStart, 0);

  // Reusing one Chrome tab for another PDF must clear all document-bound Source/thread state.
  const reusedPage = await browser.newPage();
  await reusedPage.goto(pdfUrl);
  await reusedPage.bringToFront();
  await wait(500);
  const reusedTabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id ?? null);
  assert.notEqual(reusedTabId, null);
  const reusedFirstCapture = await probePage.evaluate(async ({ selectionText, pageUrl, tabId }) =>
    chrome.runtime.sendMessage({ type: "probe-capture-selection", payload: { selectionText, pageUrl, tabId } }),
  { selectionText: selectedSentence, pageUrl: pdfUrl, tabId: reusedTabId });
  assert.equal(reusedFirstCapture?.ok, true, reusedFirstCapture?.error ?? "Same-tab first PDF capture failed");
  const firstReusedBookId = reusedFirstCapture.state?.bookId;
  assert(firstReusedBookId);
  assert.equal(reusedFirstCapture.state?.sources?.length, 1);

  await reusedPage.goto(duplicatePdfUrl);
  await reusedPage.bringToFront();
  await wait(500);
  const resetAfterNavigation = await readTabState(worker, reusedTabId);
  assert.equal(resetAfterNavigation?.status, "idle", "Same-tab PDF navigation did not reset the previous document state");
  assert.equal(resetAfterNavigation?.sources?.length, 0, "Previous PDF sources leaked into the new document");
  assert.equal(resetAfterNavigation?.threadId, null, "Previous PDF chat thread leaked into the new document");

  const reusedSecondCapture = await probePage.evaluate(async ({ selectionText, pageUrl, tabId }) =>
    chrome.runtime.sendMessage({ type: "probe-capture-selection", payload: { selectionText, pageUrl, tabId } }),
  { selectionText: "Shared statement appears in two chapters.", pageUrl: duplicatePdfUrl, tabId: reusedTabId });
  assert.equal(reusedSecondCapture?.ok, true, reusedSecondCapture?.error ?? "Same-tab second PDF capture failed");
  assert.equal(reusedSecondCapture.state?.status, "ambiguous");
  assert.notEqual(reusedSecondCapture.state?.bookId, firstReusedBookId, "Same-tab navigation reused the previous managed book");
  assert.equal(reusedSecondCapture.state?.sources?.length, 0, "Old sources reappeared after second PDF capture");
  assert.equal(reusedSecondCapture.state?.threadId, null, "Old thread reappeared after second PDF capture");

  // Server outage is surfaced in the Side Panel rather than failing silently.
  // Bring the target PDF tab back to the foreground because Side Panel UI follows the active tab.
  await authPage.bringToFront();
  await wait(250);
  await worker.evaluate(async () => chrome.storage.local.set({ deepReaderServerBase: "http://127.0.0.1:65530/api" }));
  const offlineCapture = await probePage.evaluate(async ({ selectionText, pageUrl, tabId }) =>
    chrome.runtime.sendMessage({ type: "probe-capture-selection", payload: { selectionText, pageUrl, tabId } }),
  { selectionText: "The browser cookie is required when the extension refetches this PDF.", pageUrl: authenticatedPdfUrl, tabId: authTabId });
  assert.equal(offlineCapture?.ok, false, "Offline server capture unexpectedly succeeded");
  await sidePanel.waitForSelector(".capture-status.error", { timeout: 30_000 });
  await worker.evaluate(async (base) => chrome.storage.local.set({ deepReaderServerBase: base }), serverBase);

  console.log(JSON.stringify({
    extensionId,
    pdfViewer: "chrome-built-in",
    selectedTextVerified: true,
    sidePanelOpened: true,
    resolvedPage: 1,
    codexModel: codexStatus.models.find((model) => model.isDefault)?.id ?? null,
    progressiveRetrievalEvents: assistant.retrievalEvents.length,
    aiExpandedCitationPage: 3,
    citationReturnedToPage: 3,
    localFilePdfResolved: true,
    duplicateSelectionCandidates: 2,
    tabStateIsolation: true,
    sameTabDocumentReset: true,
    authenticatedPdfResolved: true,
    insightSaved: true,
    insightVersion2: true,
    multipleChatUi: true,
    retrievalAuditVisible: true,
    serverOutageSurfaced: true,
  }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  for (const child of children) stopChild(child);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(localPdfPath, { force: true });
}

async function selectAllViewerText(browser, expectedText) {
  let lastText = "";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const target = viewerTarget(browser);
    const session = await target.createCDPSession();
    const response = await session.send("Runtime.evaluate", {
      expression: `(async () => {
        const viewer = document.querySelector('pdf-viewer');
        if (!viewer?.pluginController_) return '';
        viewer.pluginController_.selectAll();
        await new Promise((resolve) => setTimeout(resolve, 100));
        return (await viewer.pluginController_.getSelectedText()).selectedText;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    lastText = String(response.result.value ?? "");
    if (!expectedText || lastText.includes(expectedText)) return lastText;
    await wait(100);
  }
  return lastText;
}

async function readViewerCurrentPage(browser, expectedPage = null) {
  let lastValue = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const target = viewerTarget(browser);
    const session = await target.createCDPSession();
    const response = await session.send("Runtime.evaluate", {
      expression: `(() => {
        const viewer = document.querySelector('pdf-viewer');
        const toolbar = viewer?.shadowRoot?.querySelector('viewer-toolbar');
        const selector = toolbar?.shadowRoot?.querySelector('viewer-page-selector');
        return selector?.shadowRoot?.querySelector('input')?.value ?? null;
      })()`,
      returnByValue: true,
    });
    lastValue = response.result.value ?? null;
    if (expectedPage ? String(lastValue) === expectedPage : lastValue && String(lastValue) !== "0") return lastValue;
    await wait(100);
  }
  return lastValue;
}

function viewerTarget(browser) {
  const target = browser.targets().find((candidate) =>
    candidate.url().includes("mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html"),
  );
  assert(target, "Chrome built-in PDF viewer target not found");
  return target;
}

async function readTabState(worker, tabId) {
  return worker.evaluate(async (id) => {
    const key = `deepReaderTabState:${id}`;
    const stored = await chrome.storage.local.get(key);
    return stored[key] ?? null;
  }, tabId);
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

async function jsonFetch(url) {
  const response = await fetch(url);
  const text = await response.text();
  assert(response.ok, `${url}: ${response.status} ${text}`);
  return JSON.parse(text);
}

function attachChildDiagnostics(child) {
  child.stdout?.on("data", (chunk) => process.env.DEEP_READER_E2E_VERBOSE && process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.env.DEEP_READER_E2E_VERBOSE && process.stderr.write(chunk));
}
function stopChild(child) {
  if (child.exitCode === null) child.kill("SIGTERM");
}
function wait(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
