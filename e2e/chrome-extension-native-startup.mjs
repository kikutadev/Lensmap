import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import puppeteer from "puppeteer";
import { extensionLaunchOptions } from "./chrome-launch.mjs";

const root = process.cwd();
const extensionPath = resolve(root, "apps/chrome-extension/.output/chrome-mv3");
const controllerPath = resolve(root, "scripts/lensmap-server.mjs");
const profilePath = resolve(root, ".runtime/chrome-native-startup-profile");
const profileNativeHostDir = resolve(profilePath, "NativeMessagingHosts");
const installedNativeHostManifest = resolve(
  homedir(),
  "Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts/com.lensmap.launcher.json",
);
const profileNativeHostManifest = resolve(profileNativeHostDir, "com.lensmap.launcher.json");
const nodeBin = process.env.LENSMAP_SERVER_NODE ?? process.execPath;
const expectedExtensionId = "golbkehcbfidgeijhpagmeiomgfedgmo";
const healthUrl = "http://127.0.0.1:4317/api/health";

const wasRunning = await isHealthy();
let browser;
try {
  if (wasRunning) runController("stop");
  assert.equal(await isHealthy(), false, "Lensmap Server must be stopped before Native Messaging startup E2E");

  // Keep E2E isolated from the user's normal Chrome process. A custom user-data directory means
  // Chrome also resolves user-level Native Messaging hosts from that profile's NativeMessagingHosts directory.
  rmSync(profilePath, { recursive: true, force: true });
  mkdirSync(profileNativeHostDir, { recursive: true });
  copyFileSync(installedNativeHostManifest, profileNativeHostManifest);

  const launchOptions = extensionLaunchOptions(extensionPath);
  browser = await puppeteer.launch({
    ...launchOptions,
    pipe: false,
    userDataDir: profilePath,
    protocolTimeout: 120_000,
  });

  const workerTarget = await browser.waitForTarget(
    (target) => target.type() === "service_worker" && target.url().endsWith("background.js"),
    { timeout: 20_000 },
  );
  const extensionId = new URL(workerTarget.url()).host;
  assert.equal(extensionId, expectedExtensionId, "Extension ID must remain stable for Native Messaging allowed_origins");

  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/probe.html`);
  const response = await page.evaluate(() => chrome.runtime.sendMessage({ type: "ensure-server" }));
  assert.equal(response?.ok, true, response?.error ?? "Extension failed to start Lensmap Server");
  assert.equal(await waitForHealth(12_000), true, "Lensmap Server did not become healthy after extension request");

  const secondResponse = await page.evaluate(() => chrome.runtime.sendMessage({ type: "ensure-server" }));
  assert.equal(secondResponse?.ok, true, secondResponse?.error ?? "Second ensure-server call was not idempotent");

  console.log(JSON.stringify({
    ok: true,
    extensionId,
    nativeMessagingStartup: true,
    secondEnsureIdempotent: true,
    serverHealthy: true,
    isolatedProfile: true,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  rmSync(profilePath, { recursive: true, force: true });
  if (wasRunning) {
    runController("start");
  } else {
    runController("stop");
  }
}

function runController(command) {
  const result = spawnSync(nodeBin, [controllerPath, command], {
    cwd: root,
    stdio: "ignore",
    env: process.env,
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0 && command !== "stop") {
    throw new Error(`Lensmap Server controller failed: ${command}`);
  }
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy()) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return false;
}

async function isHealthy() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}
