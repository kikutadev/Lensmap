import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const landingRoot = path.join(repoRoot, "apps/landing-page");
const astroCli = path.join(landingRoot, "node_modules/astro/bin/astro.mjs");
const artifacts = path.join(repoRoot, ".e2e-artifacts/landing-page");
const port = Number(process.env.LENSMAP_LP_TEST_PORT ?? 4322);
const origin = `http://127.0.0.1:${port}`;
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

await fs.mkdir(artifacts, { recursive: true });

const server = spawn(process.execPath, [astroCli, "preview", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: landingRoot,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

try {
  await waitForServer(`${origin}/`);
  const browser = await puppeteer.launch({ headless: true, executablePath: chromePath });
  try {
    const cases = [
      { name: "desktop-light-ja", url: "/", width: 1440, height: 1000, scheme: "light" },
      { name: "mobile-light-ja", url: "/", width: 390, height: 844, scheme: "light" },
      { name: "desktop-dark-en", url: "/en/", width: 1440, height: 1000, scheme: "dark" },
    ];

    for (const testCase of cases) {
      const page = await browser.newPage();
      const consoleErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));

      await page.setViewport({ width: testCase.width, height: testCase.height, deviceScaleFactor: 1 });
      await page.emulateMediaFeatures([
        { name: "prefers-color-scheme", value: testCase.scheme },
        { name: "prefers-reduced-motion", value: "reduce" },
      ]);
      await page.goto(`${origin}${testCase.url}`, { waitUntil: "networkidle0" });

      // Exercise lazy product media as an actual reader would by scrolling through the page.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        window.scrollTo(0, 0);
      });
      await page.evaluate(() => Promise.all(Array.from(document.images, (image) => image.decode().catch(() => undefined))));

      const result = await page.evaluate(() => {
        const headings = Array.from(document.querySelectorAll("h1"));
        const images = Array.from(document.images);
        const anchors = Array.from(document.querySelectorAll("a[href]"));
        return {
          title: document.title,
          h1Count: headings.length,
          language: document.documentElement.lang,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          brokenImages: images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.src),
          emptyLinks: anchors.filter((anchor) => !(anchor.getAttribute("href") ?? "").trim()).length,
          canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "",
          ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? "",
        };
      });

      assert(result.h1Count === 1, `${testCase.name}: expected exactly one h1`);
      assert(result.scrollWidth === result.clientWidth, `${testCase.name}: horizontal overflow ${result.scrollWidth} > ${result.clientWidth}`);
      assert(result.brokenImages.length === 0, `${testCase.name}: broken images: ${result.brokenImages.join(", ")}`);
      assert(result.emptyLinks === 0, `${testCase.name}: empty links found`);
      assert(result.canonical.startsWith("https://lensmap.kikuta.dev/"), `${testCase.name}: invalid canonical ${result.canonical}`);
      assert(result.ogImage.startsWith("https://lensmap.kikuta.dev/og/"), `${testCase.name}: invalid OG image ${result.ogImage}`);
      assert(consoleErrors.length === 0, `${testCase.name}: console errors: ${consoleErrors.join(" | ")}`);

      await page.screenshot({ path: path.join(artifacts, `${testCase.name}.png`), fullPage: true });
      console.log(`[lp-e2e] ${testCase.name}: ${result.title}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
}

console.log(`[lp-e2e] visual artifacts: ${path.relative(repoRoot, artifacts)}`);

async function waitForServer(url) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Preview server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for Astro preview at ${url}\n${serverOutput}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
