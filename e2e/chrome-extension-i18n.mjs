import assert from "node:assert/strict";
import { cpSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer";
import { extensionLaunchOptions } from "./chrome-launch.mjs";

const root = process.cwd();
const builtExtensionPath = resolve(root, "apps/chrome-extension/.output/chrome-mv3");
const extensionPath = resolve(root, ".extension-i18n-e2e-build");

rmSync(extensionPath, { recursive: true, force: true });
cpSync(builtExtensionPath, extensionPath, { recursive: true });

let browser;
try {
  browser = await puppeteer.launch(extensionLaunchOptions(extensionPath));
  const workerTarget = await browser.waitForTarget(
    (target) => target.type() === "service_worker" && target.url().endsWith("background.js"),
    { timeout: 20_000 },
  );
  const worker = await workerTarget.worker();
  assert(worker, "Extension service worker was not created");
  const extensionId = new URL(workerTarget.url()).host;

  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      "lensmap.localePreference": "en",
      "lensmap.onboardingDismissed": false,
    });
  });

  const probe = await browser.newPage();
  await probe.goto(`chrome-extension://${extensionId}/probe.html`, { waitUntil: "domcontentloaded" });
  const sideTargetPromise = browser.waitForTarget(
    (target) => target.url() === `chrome-extension://${extensionId}/sidepanel.html`,
    { timeout: 15_000 },
  );
  await probe.click("#open");
  const sideTarget = await sideTargetPromise;
  const sidePanel = await sideTarget.asPage();
  assert(sidePanel, "Side Panel target could not be controlled");
  await sidePanel.waitForSelector(".onboarding-card", { timeout: 15_000 });
  await assertLocale(sidePanel, {
    lang: "en",
    include: ["Getting started with Lensmap", "Detailed guide", "Get started"],
    exclude: ["Lensmapのはじめ方", "詳しい使い方", "使い始める"],
  });

  const help = await browser.newPage();
  await help.goto(`chrome-extension://${extensionId}/help.html`, { waitUntil: "domcontentloaded" });
  await help.waitForSelector("#language-preference", { timeout: 15_000 });
  await help.waitForFunction(() => document.body.textContent?.includes("Getting started"), { timeout: 15_000 });
  assert.equal(await help.$eval("#language-preference", (element) => element.value), "en");
  await assertLocale(help, {
    lang: "en",
    include: ["Getting started", "Codex App Server", "Display language"],
    exclude: ["はじめ方", "表示言語"],
  });

  await worker.evaluate(async () => {
    await chrome.storage.local.set({ "lensmap.localePreference": "ja" });
  });

  await sidePanel.waitForFunction(() => document.body.textContent?.includes("Lensmapのはじめ方"), { timeout: 15_000 });
  await help.waitForFunction(() => document.body.textContent?.includes("はじめ方"), { timeout: 15_000 });
  assert.equal(await help.$eval("#language-preference", (element) => element.value), "ja");
  await assertLocale(sidePanel, {
    lang: "ja",
    include: ["Lensmapのはじめ方", "詳しい使い方", "使い始める"],
    exclude: ["Getting started with Lensmap", "Detailed guide", "Get started"],
  });
  await assertLocale(help, {
    lang: "ja",
    include: ["はじめ方", "Codex App Server", "表示言語"],
    exclude: ["Getting started", "Display language"],
  });

  await help.select("#language-preference", "en");
  await sidePanel.waitForFunction(() => document.body.textContent?.includes("Getting started with Lensmap"), { timeout: 15_000 });
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get("lensmap.localePreference"))["lensmap.localePreference"]), "en");
  assert.equal(await help.$eval("html", (element) => element.lang), "en");
  assert.equal(await sidePanel.$eval("html", (element) => element.lang), "en");

  console.log(JSON.stringify({ extensionId, locales: ["en", "ja"], runtimeSwitch: true, persistedSelector: true }));
} finally {
  if (browser) await browser.close();
  rmSync(extensionPath, { recursive: true, force: true });
}

async function assertLocale(page, { lang, include, exclude }) {
  assert.equal(await page.$eval("html", (element) => element.lang), lang);
  const text = await page.$eval("body", (element) => element.textContent ?? "");
  for (const value of include) assert(text.includes(value), `Expected ${lang} UI to include: ${value}`);
  for (const value of exclude) assert(!text.includes(value), `Expected ${lang} UI to exclude stale copy: ${value}`);
}
