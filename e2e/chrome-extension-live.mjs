import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import puppeteer from "puppeteer";
import { extensionLaunchOptions } from "./chrome-launch.mjs";

const root = process.cwd();
const builtExtensionPath = resolve(root, "apps/chrome-extension/.output/chrome-mv3");
const extensionPath = resolve(root, ".extension-e2e-build");
const dataDir = resolve(root, ".extension-e2e-data");
const migrationsDir = resolve(root, "apps/server/drizzle");
const localPdfPath = resolve(root, ".extension-e2e-local.pdf");
const visualAcceptanceDir = resolve(root, ".e2e-artifacts/lensmap-sidepanel");
const nodeBin = process.env.LENSMAP_SERVER_NODE ?? process.execPath;
const serverPort = await findFreeLoopbackPort();
const pdfPort = await findFreeLoopbackPort();
const serverBase = `http://127.0.0.1:${serverPort}/api`;
const capabilityToken = randomBytes(32).toString("base64url");
const pdfUrl = `http://127.0.0.1:${pdfPort}/book.pdf`;
const duplicatePdfUrl = `http://127.0.0.1:${pdfPort}/duplicate.pdf`;
const authenticatedLoginUrl = `http://127.0.0.1:${pdfPort}/auth/login`;
const authenticatedPdfUrl = `http://127.0.0.1:${pdfPort}/auth/book.pdf`;
const selectedSentence = "Remote cache invalidation is delegated to BlueGate, which is defined later in this book.";
const question = "この抜粋だけではBlueGateの定義がありません。Workspace内を追加参照してBlueGateの定義を日本語で説明してください。書籍本文に基づく説明には必ずSource IDを付けてください。";

rmSync(dataDir, { recursive: true, force: true });
rmSync(localPdfPath, { force: true });
rmSync(extensionPath, { recursive: true, force: true });
rmSync(visualAcceptanceDir, { recursive: true, force: true });
mkdirSync(visualAcceptanceDir, { recursive: true });
cpSync(builtExtensionPath, extensionPath, { recursive: true });
// Headless Chrome cannot accept the native optional-host permission prompt. Grant <all_urls> only
// in this disposable E2E copy; production keeps it optional and requests it on explicit Visual Capture.
const e2eManifestPath = resolve(extensionPath, "manifest.json");
const e2eManifest = JSON.parse(readFileSync(e2eManifestPath, "utf8"));
e2eManifest.host_permissions = [...new Set([...(e2eManifest.host_permissions ?? []), "<all_urls>"])];
e2eManifest.optional_host_permissions = [];
writeFileSync(e2eManifestPath, JSON.stringify(e2eManifest, null, 2));
const children = [];
let browser;

try {
  children.push(spawn(nodeBin, ["e2e/chrome-pdf-fixture-server.mjs"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LENSMAP_PDF_PORT: String(pdfPort) },
  }));
  children.push(spawn(nodeBin, ["apps/server/dist/index.js"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      LENSMAP_DATA_DIR: dataDir,
      LENSMAP_MIGRATIONS_DIR: migrationsDir,
      LENSMAP_HOST: "127.0.0.1",
      LENSMAP_PORT: String(serverPort),
      LENSMAP_CAPABILITY_TOKEN: capabilityToken,
      LENSMAP_OCR_BIN: resolve(root, "native/macos/bin/lensmap-ocr"),
      CODEX_BIN: process.env.CODEX_BIN ?? "/Applications/ChatGPT.app/Contents/Resources/codex",
    },
  }));
  for (const child of children) attachChildDiagnostics(child);

  await waitForHttp(`${serverBase}/health`, 30_000);
  await waitForHttp(pdfUrl, 15_000);
  const codexStatus = await apiJson("/codex/status");
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

  await worker.evaluate(async ({ configuredServerBase, token }) => {
    await chrome.storage.local.set({ "lensmap.serverBase": configuredServerBase, "lensmap.localePreference": "ja" });
    await chrome.storage.session.set({ "lensmap.capabilityToken": token });
    let lastError = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        await Promise.all([
          chrome.contextMenus.update("lensmap-explore", { visible: true }),
          chrome.contextMenus.update("lensmap-add-reference", { visible: true }),
          chrome.contextMenus.update("lensmap-capture-region", { visible: true }),
        ]);
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      }
    }
    throw lastError ?? new Error("Canonical Lensmap context menus were not registered");
  }, { configuredServerBase: serverBase, token: capabilityToken });

  const pdfPage = await browser.newPage();
  await pdfPage.goto(pdfUrl);
  await wait(900);
  assert(browser.targets().some(isPdfViewerTarget), "Chrome built-in PDF viewer did not load");
  const selectedText = await selectAllViewerText(browser, selectedSentence);
  assert(selectedText.includes(selectedSentence), "Chrome PDF viewer selection did not contain expected page-1 text");

  await pdfPage.bringToFront();
  const pdfTabId = await activeTabId(worker);
  assert.notEqual(pdfTabId, null, "Could not resolve PDF tab id");

  const probePage = await browser.newPage();
  await probePage.goto(`chrome-extension://${extensionId}/probe.html`);
  await probePage.click("#open");
  const sideTarget = await browser.waitForTarget(
    (target) => target.url() === `chrome-extension://${extensionId}/sidepanel.html`,
    { timeout: 10_000 },
  );
  const sidePanel = await sideTarget.asPage();
  assert(sidePanel, "Chrome Side Panel target could not be controlled");
  await sidePanel.setViewport({ width: 390, height: 900, deviceScaleFactor: 1 });

  // First-run onboarding is lightweight, dismissible, and must not return after dismissal.
  await sidePanel.waitForSelector(".onboarding-card", { timeout: 15_000 });
  const onboardingText = await sidePanel.$eval(".onboarding-card", (element) => element.textContent ?? "");
  for (const label of ["Focus", "Explore", "Map", "Return"]) assert(onboardingText.includes(label), `Onboarding is missing ${label}`);
  await sidePanel.screenshot({ path: resolve(visualAcceptanceDir, "01-onboarding.png") });
  await sidePanel.evaluate(() => {
    const button = [...document.querySelectorAll(".onboarding-actions button")].find((candidate) => candidate.textContent?.includes("使い始める"));
    if (!(button instanceof HTMLButtonElement)) throw new Error("Onboarding dismiss button not found");
    button.click();
  });
  await sidePanel.waitForFunction(() => !document.querySelector(".onboarding-card"), { timeout: 10_000 });
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get("lensmap.onboardingDismissed"))["lensmap.onboardingDismissed"]), true);
  await sidePanel.reload({ waitUntil: "domcontentloaded" });
  await wait(300);
  assert.equal(await sidePanel.$(".onboarding-card"), null, "Dismissed onboarding reappeared after Side Panel reload");

  await pdfPage.bringToFront();
  const textCapture = await captureText(probePage, {
    selectionText: selectedSentence,
    pageUrl: pdfUrl,
    tabId: pdfTabId,
    focusComposer: true,
  });
  assert.equal(textCapture.ok, true, textCapture.error ?? "Text Source pipeline failed");
  assert.equal(textCapture.state?.status, "ready");
  assert(textCapture.state?.workspaceId, "Capture did not resolve an active Reader Workspace");
  const workspaceId = textCapture.state.workspaceId;
  const bookId = textCapture.state.bookId;
  assert(bookId, "Capture did not resolve a Book");

  const workspaceAfterText = await apiJson(`/workspaces/${workspaceId}`);
  assert.equal(workspaceAfterText.sources.length, 1, "Text Source was not routed to the Workspace");
  assert.equal(workspaceAfterText.sources[0]?.kind, "text");
  assert.equal(workspaceAfterText.sources[0]?.pageStart, 0);

  try {
    await sidePanel.waitForSelector(".source-card", { timeout: 30_000 });
  } catch (error) {
    const diagnostics = await sidePanel.evaluate(() => ({ text: document.body.textContent, html: document.body.innerHTML.slice(0, 4000) }));
    throw new Error(`Side Panel did not render Workspace source: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
  const sourceDisplay = await sidePanel.$eval(".source-card", (element) => element.textContent ?? "");
  assert(sourceDisplay.includes("p.1"));
  assert(sourceDisplay.includes("Remote cache invalidation"));

  await sendExplore(sidePanel, question);
  await sidePanel.waitForFunction(
    () => [...document.querySelectorAll(".citation-row button")].some((button) => button.textContent?.includes("PDF p.3")),
    { timeout: 180_000 },
  );
  await sidePanel.waitForSelector(".retrieval-audit", { timeout: 30_000 });
  await sidePanel.waitForSelector(".map-save-state", { timeout: 30_000 });
  await sidePanel.screenshot({ path: resolve(visualAcceptanceDir, "02-explore-response.png"), fullPage: true });

  const explore = await apiJson(`/workspaces/${workspaceId}/explore`);
  const assistant = [...(explore.thread?.messages ?? [])].reverse().find((message) => message.role === "assistant");
  assert.equal(assistant?.status, "completed");
  assert((assistant?.retrievalEvents?.length ?? 0) > 0, "Explore did not perform progressive Workspace retrieval");
  const pageThreeSource = assistant?.sources?.find(
    (source) => source.kind === "text" && source.origin === "ai-expansion" && source.pageStart === 2 && assistant.content.includes(`[${source.label}]`),
  );
  assert(pageThreeSource, "Explore did not cite an AI-expanded source from PDF page 3");

  const mapsAfterExplore = await apiJson(`/maps?workspaceId=${encodeURIComponent(workspaceId)}`);
  assert.equal(mapsAfterExplore.artifacts.length, 1, "Completed Explore answer was not auto-saved as exactly one Map");
  const firstMapId = mapsAfterExplore.artifacts[0].id;
  assert(mapsAfterExplore.artifacts[0].sourceBooks.some((book) => book.bookId === bookId));
  assert.equal(mapsAfterExplore.artifacts[0].semanticKind, "definition", "Definition question was not saved as a definition Map");
  assert.equal(mapsAfterExplore.artifacts[0].primaryBlock?.kind, "definition", "Definition Map did not expose its structured definition as primary content");

  // Re-reading/creating the same Map from the same completed message remains idempotent.
  const duplicateMap = await apiJson("/maps/from-message", {
    method: "POST",
    body: { messageId: assistant.id },
  });
  assert.equal(duplicateMap.artifact.id, firstMapId, "Map auto-save idempotency was broken");
  const mapsAfterRetry = await apiJson(`/maps?workspaceId=${encodeURIComponent(workspaceId)}`);
  assert.equal(mapsAfterRetry.artifacts.length, 1, "Retry created a duplicate Map");

  // Citation returns to the actual source PDF page, independently of the currently selected Workspace.
  await sidePanel.evaluate(() => {
    const button = [...document.querySelectorAll(".citation-row button")]
      .find((candidate) => candidate.textContent?.includes("PDF p.3"));
    if (!(button instanceof HTMLButtonElement)) throw new Error("PDF p.3 citation button not found");
    button.click();
  });
  await wait(1200);
  assert.equal(pdfPage.url(), `${pdfUrl}#page=3`, "Citation did not update PDF fragment");
  assert.equal(String(await readViewerCurrentPage(browser, "3")), "3", "Built-in PDF viewer did not navigate to PDF page 3");

  // Visual Source: capture the visible PDF viewport, drag a region in the extension-owned Capture Surface,
  // crop PNG, persist it, and attach it to the same Workspace.
  await pdfPage.bringToFront();
  const captureTargetPromise = browser.waitForTarget(
    (target) => target.url().includes(`chrome-extension://${extensionId}/visual-capture.html?captureId=`),
    { timeout: 20_000 },
  );
  await sidePanel.click(".visual-capture-button");
  const captureTarget = await captureTargetPromise;
  const capturePage = await captureTarget.asPage();
  assert(capturePage, "Visual Capture Surface was not opened");
  await capturePage.waitForSelector("#capture-image:not([hidden])", { timeout: 15_000 });
  const imageBox = await capturePage.$eval("#capture-image", (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
  assert(imageBox.width > 100 && imageBox.height > 100, "Captured viewport image was not rendered");
  await capturePage.mouse.move(imageBox.x + imageBox.width * 0.15, imageBox.y + imageBox.height * 0.2);
  await capturePage.mouse.down();
  await capturePage.mouse.move(imageBox.x + imageBox.width * 0.72, imageBox.y + imageBox.height * 0.72, { steps: 8 });
  await capturePage.mouse.up();
  await capturePage.waitForFunction(() => !document.querySelector("#save")?.hasAttribute("disabled"));
  await capturePage.click("#save");
  try {
    await waitForTargetGone(browser, captureTarget, 35_000);
  } catch (error) {
    const captureDiagnostics = await capturePage.evaluate(() => ({
      status: document.querySelector("#status")?.textContent ?? "",
      statusClass: document.querySelector("#status")?.className ?? "",
      saveDisabled: document.querySelector("#save")?.hasAttribute("disabled") ?? null,
      body: document.body.textContent ?? "",
    })).catch(() => null);
    const workspaceDiagnostics = await apiJson(`/workspaces/${workspaceId}`).catch((reason) => ({ error: String(reason) }));
    throw new Error(`Extension Capture Surface did not close: ${JSON.stringify({ captureDiagnostics, workspaceDiagnostics })}`, { cause: error });
  }

  await waitFor(async () => {
    const workspace = await apiJson(`/workspaces/${workspaceId}`);
    return workspace.sources.some((source) => source.kind === "visual");
  }, 30_000, "Visual Source was not attached to Workspace");
  const workspaceAfterVisual = await apiJson(`/workspaces/${workspaceId}`);
  const visualSource = workspaceAfterVisual.sources.find((source) => source.kind === "visual");
  assert(visualSource?.imageAssetId, "Visual Source does not retain primary PNG asset");
  assert(["unresolved", "page-resolved", "rect-resolved"].includes(visualSource.locationStatus));
  const visualAsset = await apiFetch(`/books/${visualSource.bookId}/sources/assets/${visualSource.imageAssetId}`);
  assert.equal(visualAsset.headers.get("content-type"), "image/png");
  assert((await visualAsset.arrayBuffer()).byteLength > 100, "Visual Source PNG was empty");

  // Maps UI is semantic-primary and supports immutable version editing without raw JSON.
  await sidePanel.bringToFront();
  await sidePanel.evaluate(() => {
    const button = [...document.querySelectorAll(".view-tabs button")].find((candidate) => candidate.textContent?.trim() === "Maps");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Maps tab not found");
    button.click();
  });
  await sidePanel.waitForSelector(".map-list-item", { timeout: 30_000 });
  await sidePanel.waitForSelector(".map-thumbnail.definition", { timeout: 30_000 });
  await sidePanel.screenshot({ path: resolve(visualAcceptanceDir, "03-map-list.png"), fullPage: true });
  await sidePanel.click(".map-list-item");
  await sidePanel.waitForSelector(".map-detail", { timeout: 30_000 });
  await sidePanel.waitForSelector(".viz-definition", { timeout: 30_000 });
  const renderedDefinition = await sidePanel.$eval(".viz-card", (element) => element.textContent ?? "");
  assert(renderedDefinition.includes("BlueGate"), "Primary definition renderer did not show the structured term");
  assert((await sidePanel.$eval(".viz-definition", (element) => element.textContent ?? "")).trim().length > 0, "Primary definition renderer did not show definition content");
  assert.equal(await sidePanel.$(".rich-error"), null, "Structured definition fell back to an invalid visualization error");
  await sidePanel.screenshot({ path: resolve(visualAcceptanceDir, "04-map-detail.png"), fullPage: true });
  await sidePanel.evaluate(() => {
    const button = [...document.querySelectorAll(".map-toolbar button")].find((candidate) => candidate.textContent?.includes("編集"));
    if (!(button instanceof HTMLButtonElement)) throw new Error("Map edit button not found");
    button.click();
  });
  await sidePanel.waitForSelector(".map-editor textarea");
  const firstDraft = await sidePanel.$eval(".map-editor textarea", (element) => element.value);
  await sidePanel.$eval(".map-editor textarea", (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, `${firstDraft}\n\nユーザー編集メモ`);
  await sidePanel.evaluate(() => {
    const button = [...document.querySelectorAll(".editor-actions button")].find((candidate) => candidate.textContent?.includes("新しいversionとして保存"));
    if (!(button instanceof HTMLButtonElement)) throw new Error("Map version save button not found");
    button.click();
  });
  await sidePanel.waitForFunction(() => document.querySelector(".map-meta")?.textContent?.includes("v2"), { timeout: 30_000 });
  const mapV2 = await apiJson(`/maps/${firstMapId}`);
  assert.equal(mapV2.artifact.version, 2, "Map edit did not create immutable v2");

  // Explore threads belong to the Workspace, not to the active Chrome tab.
  await sidePanel.evaluate(() => {
    const button = [...document.querySelectorAll(".view-tabs button")].find((candidate) => candidate.textContent?.trim() === "Explore");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Explore tab not found");
    button.click();
  });
  await sidePanel.waitForSelector("select[aria-label='Explore thread']");
  const beforeThreads = await apiJson(`/workspaces/${workspaceId}/explore/threads`);
  await sidePanel.evaluate(() => {
    const button = document.querySelector('button[aria-label="新しいExplore"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error("New Explore button not found");
    button.click();
  });
  await waitFor(async () => (await apiJson(`/workspaces/${workspaceId}/explore/threads`)).threads.length > beforeThreads.threads.length, 30_000, "New Explore thread was not created");

  // A second PDF can join the same Workspace without replacing the first PDF/Explore state.
  const duplicatePage = await browser.newPage();
  await duplicatePage.goto(duplicatePdfUrl);
  await duplicatePage.bringToFront();
  await wait(600);
  const duplicateTabId = await activeTabId(worker);
  const duplicateCapture = await captureText(probePage, {
    selectionText: "Shared statement appears in two chapters.",
    pageUrl: duplicatePdfUrl,
    tabId: duplicateTabId,
  });
  assert.equal(duplicateCapture?.ok, true, duplicateCapture?.error ?? "Second PDF capture failed");
  assert.equal(duplicateCapture.state?.workspaceId, workspaceId, "Second PDF did not route to active Workspace");
  assert.equal(duplicateCapture.state?.status, "ambiguous");
  assert.equal(duplicateCapture.state?.resolutionCandidates?.length, 2);
  const resolvedDuplicate = await probePage.evaluate(async ({ tabId }) =>
    chrome.runtime.sendMessage({ type: "resolve-selection-candidate", tabId, candidateIndex: 1 }),
  { tabId: duplicateTabId });
  assert.equal(resolvedDuplicate?.ok, true, resolvedDuplicate?.error ?? "Ambiguous selection could not be resolved");
  const crossPdfWorkspace = await apiJson(`/workspaces/${workspaceId}`);
  assert(crossPdfWorkspace.books.length >= 2, "Workspace did not retain both PDFs");
  assert(crossPdfWorkspace.sources.some((source) => source.bookId !== bookId), "Second PDF source was not retained alongside first PDF sources");
  assert((await apiJson(`/workspaces/${workspaceId}/explore/threads`)).threads.length > beforeThreads.threads.length, "Switching PDF tabs lost Workspace Explore threads");

  // Capture metadata resets when one Chrome tab navigates to another PDF, while Workspace data remains intact.
  const reusedPage = await browser.newPage();
  await reusedPage.goto(pdfUrl);
  await reusedPage.bringToFront();
  await wait(500);
  const reusedTabId = await activeTabId(worker);
  const reusedFirst = await captureText(probePage, { selectionText: selectedSentence, pageUrl: pdfUrl, tabId: reusedTabId });
  assert.equal(reusedFirst?.ok, true);
  await reusedPage.goto(duplicatePdfUrl);
  await wait(600);
  const resetCaptureState = await readTabState(worker, reusedTabId);
  assert.equal(resetCaptureState?.status, "idle", "Same-tab PDF navigation did not reset capture metadata");
  assert.equal(resetCaptureState?.bookId, null, "Old document identity leaked after same-tab navigation");
  const workspaceAfterNavigation = await apiJson(`/workspaces/${workspaceId}`);
  assert(workspaceAfterNavigation.sources.length >= crossPdfWorkspace.sources.length, "Tab navigation incorrectly cleared Workspace evidence");

  // file:// and cookie-authenticated PDFs still use the same text capture pipeline.
  const localPdfBytes = Buffer.from(await (await fetch(pdfUrl)).arrayBuffer());
  writeFileSync(localPdfPath, localPdfBytes);
  const localPdfUrl = pathToFileURL(localPdfPath).toString();
  const localPage = await browser.newPage();
  await localPage.goto(localPdfUrl);
  await localPage.bringToFront();
  await wait(700);
  assert.equal(await worker.evaluate(() => chrome.extension.isAllowedFileSchemeAccess()), true, "File URL access is not enabled in E2E profile");
  const localCapture = await captureText(probePage, { selectionText: selectedSentence, pageUrl: localPdfUrl, tabId: await activeTabId(worker) });
  assert.equal(localCapture?.ok, true, localCapture?.error ?? "Local PDF capture failed");

  const authPage = await browser.newPage();
  await authPage.goto(authenticatedLoginUrl, { waitUntil: "networkidle0" });
  assert.equal(authPage.url(), authenticatedPdfUrl);
  await authPage.bringToFront();
  await wait(500);
  const authCapture = await captureText(probePage, {
    selectionText: "Authenticated PDF content remains readable through the Lensmap extension.",
    pageUrl: authenticatedPdfUrl,
    tabId: await activeTabId(worker),
  });
  assert.equal(authCapture?.ok, true, authCapture?.error ?? "Authenticated PDF refetch failed");

  // Help is reachable from the Side Panel and documents Workspace/Visual Source/Maps.
  await sidePanel.bringToFront();
  const helpTargetPromise = browser.waitForTarget(
    (target) => target.url() === `chrome-extension://${extensionId}/help.html`,
    { timeout: 10_000 },
  );
  await sidePanel.click(".header-help");
  const helpTarget = await helpTargetPromise;
  const helpPage = await helpTarget.asPage();
  const helpText = await helpPage.$eval("body", (element) => element.textContent ?? "");
  assert(helpText.includes("Reader Workspace"));
  assert(helpText.includes("Visual Source"));
  assert(helpText.includes("Maps"));
  assert(helpText.includes("はじめ方"), "Help did not honor the forced Japanese locale");
  assert(helpText.includes("Codex App Server"), "Help does not document Codex App Server");

  // Runtime override must update already-open React and static extension pages without a rebuild.
  await worker.evaluate(async () => chrome.storage.local.set({ "lensmap.localePreference": "en" }));
  await sidePanel.waitForFunction(() => document.querySelector('button[aria-label="New Explore"]'), { timeout: 10_000 });
  await helpPage.waitForFunction(() => document.body.textContent?.includes("Getting started"), { timeout: 10_000 });
  assert.equal(await helpPage.$eval("#language-preference", (element) => element.value), "en");
  assert.equal(await helpPage.$eval("html", (element) => element.lang), "en");
  assert((await sidePanel.$eval("body", (element) => element.textContent ?? "")).includes("References"), "Side Panel did not switch to English");

  console.log(JSON.stringify({
    extensionId,
    pdfViewer: "chrome-built-in",
    canonicalContextMenus: true,
    workspaceId,
    textSourceResolved: true,
    visualSourceSaved: true,
    visualLocationStatus: visualSource.locationStatus,
    progressiveRetrievalEvents: assistant.retrievalEvents.length,
    aiExpandedCitationPage: 3,
    mapAutoSaved: true,
    mapIdempotent: true,
    mapVersion2: true,
    multiPdfWorkspace: true,
    workspaceExploreSurvivesTabSwitch: true,
    sameTabCaptureResetOnly: true,
    localFilePdfResolved: true,
    authenticatedPdfResolved: true,
    helpVerified: true,
    runtimeLocaleSwitch: true,
    onboardingDismissalPersistent: true,
    visualAcceptanceDir,
  }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  for (const child of children) stopChild(child);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(localPdfPath, { force: true });
  rmSync(extensionPath, { recursive: true, force: true });
}

async function captureText(probePage, payload) {
  return probePage.evaluate(async (input) => chrome.runtime.sendMessage({ type: "probe-capture-selection", payload: input }), payload);
}

async function sendExplore(sidePanel, text) {
  const selector = 'textarea[aria-label="質問"]';
  await sidePanel.waitForSelector(selector, { timeout: 30_000 });
  await sidePanel.click(selector);
  await sidePanel.type(selector, text);
  await sidePanel.evaluate(() => {
    const button = [...document.querySelectorAll(".composer button")].find((candidate) => candidate.textContent?.includes("送信"));
    if (!(button instanceof HTMLButtonElement)) throw new Error("Explore send button not found");
    button.click();
  });
}

async function activeTabId(worker) {
  return worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id ?? null);
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
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
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
  const target = browser.targets().find(isPdfViewerTarget);
  assert(target, "Chrome built-in PDF viewer target not found");
  return target;
}
function isPdfViewerTarget(target) { return target.url().includes("mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html"); }

async function readTabState(worker, tabId) {
  return worker.evaluate(async (id) => {
    const key = `lensmap.tabState:${id}`;
    const stored = await chrome.storage.local.get(key);
    return stored[key] ?? null;
  }, tabId);
}

async function findFreeLoopbackPort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a loopback E2E port")));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
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

async function apiJson(path, options = {}) {
  const response = await apiFetch(path, options);
  const text = await response.text();
  assert(response.ok, `${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("authorization", `Bearer ${capabilityToken}`);
  let body = options.body;
  if (body !== undefined && !(body instanceof FormData) && typeof body !== "string") {
    headers.set("content-type", "application/json");
    body = JSON.stringify(body);
  }
  return fetch(`${serverBase}${path}`, { ...options, headers, body });
}

async function waitFor(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) { lastError = error; }
    await wait(150);
  }
  throw lastError ?? new Error(message);
}

async function waitForTargetGone(browser, target, timeoutMs) {
  await waitFor(() => !browser.targets().includes(target), timeoutMs, "Extension Capture Surface did not close");
}

function attachChildDiagnostics(child) {
  child.stdout?.on("data", (chunk) => process.env.LENSMAP_E2E_VERBOSE && process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.env.LENSMAP_E2E_VERBOSE && process.stderr.write(chunk));
}
function stopChild(child) { if (child.exitCode === null) child.kill("SIGTERM"); }
function wait(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
