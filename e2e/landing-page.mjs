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
const configuredOrigin = process.env.LENSMAP_LP_ORIGIN?.replace(/\/$/, "");
const captureFullPage = process.env.LENSMAP_LP_FULL_PAGE === "1";
const origin = configuredOrigin ?? `http://127.0.0.1:${port}`;
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

await fs.mkdir(artifacts, { recursive: true });

// Start Astro Preview only for local acceptance. Production acceptance points the same suite at LENSMAP_LP_ORIGIN.
const server = configuredOrigin
  ? null
  : spawn(process.execPath, [astroCli, "preview", "--host", "127.0.0.1", "--port", String(port)], {
      cwd: landingRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

let serverOutput = "";
server?.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server?.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

try {
  await waitForServer(`${origin}/`);
  const browser = await puppeteer.launch({ headless: true, executablePath: chromePath });
  try {
    const cases = [
      { name: "desktop-light-ja", url: "/", width: 1440, height: 1000, scheme: "light" },
      { name: "mobile-compact-light-ja", url: "/", width: 320, height: 720, scheme: "light", mobile: true },
      { name: "mobile-light-ja", url: "/", width: 390, height: 844, scheme: "light", mobile: true },
      { name: "mobile-wide-dark-en", url: "/en/", width: 430, height: 932, scheme: "dark", mobile: true },
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
      const response = await page.goto(`${origin}${testCase.url}`, { waitUntil: "networkidle0" });
      const status = response?.status() ?? 0;
      assert(status >= 200 && status < 400, `${testCase.name}: page returned HTTP ${status || "unknown"}`);

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
          bodyText: document.body.textContent ?? "",
          hasRealMapExample: Boolean(document.querySelector(".real-map-example")),
          hasActualHeroMap: Boolean(document.querySelector(".actual-map-shot img")),
          realMap: (() => {
            const image = document.querySelector(".real-map-figure img");
            return image instanceof HTMLImageElement ? { src: image.src, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight } : null;
          })(),
          heroMapSrc: document.querySelector(".actual-map-shot img")?.getAttribute("src") ?? "",
          mapSourceHref: document.querySelector(".map-source-attribution a")?.getAttribute("href") ?? "",
          hasCodexSection: Boolean(document.querySelector(".codex-section")),
          installSteps: document.querySelectorAll(".install-steps > li").length,
          faqItems: document.querySelectorAll(".faq-list > details").length,
          mobileLayout: (() => {
            const hero = document.querySelector(".hero");
            const principles = document.querySelector(".principles");
            const codex = document.querySelector(".codex-architecture");
            const install = document.querySelector(".install-steps");
            const footer = document.querySelector(".site-footer");
            const navLink = document.querySelector(".site-nav a:not(.language-link)");
            const mapScroller = document.querySelector(".real-map-scroll");
            if (!(hero && principles && codex && install && footer && mapScroller)) return null;
            const columns = (element) => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length;
            return {
              heroColumns: columns(hero),
              principleColumns: columns(principles),
              codexColumns: columns(codex),
              installColumns: columns(install),
              footerColumns: columns(footer),
              desktopNavHidden: navLink ? getComputedStyle(navLink).display === "none" : true,
              mapOverflowX: getComputedStyle(mapScroller).overflowX,
              mapScrollWidth: mapScroller.scrollWidth,
              mapClientWidth: mapScroller.clientWidth,
            };
          })(),
        };
      });

      assert(result.h1Count === 1, `${testCase.name}: expected exactly one h1`);
      assert(result.scrollWidth === result.clientWidth, `${testCase.name}: horizontal overflow ${result.scrollWidth} > ${result.clientWidth}`);
      assert(result.brokenImages.length === 0, `${testCase.name}: broken images: ${result.brokenImages.join(", ")}`);
      assert(result.emptyLinks === 0, `${testCase.name}: empty links found`);
      assert(result.canonical.startsWith("https://lensmap.kikuta.dev/"), `${testCase.name}: invalid canonical ${result.canonical}`);
      assert(result.ogImage.startsWith("https://lensmap.kikuta.dev/og/"), `${testCase.name}: invalid OG image ${result.ogImage}`);
      assert(!result.bodyText.includes("BlueGate"), `${testCase.name}: internal E2E fixture name BlueGate leaked into the public LP`);
      assert(result.bodyText.includes("Codex App Server"), `${testCase.name}: Codex App Server is not explained`);
      assert(result.hasRealMapExample, `${testCase.name}: real Map example is missing`);
      assert(result.hasActualHeroMap, `${testCase.name}: actual Map is missing from the hero`);
      assert(result.realMap?.naturalWidth >= 1200, `${testCase.name}: actual Map image is too low resolution: ${result.realMap?.naturalWidth ?? 0}px`);
      const expectedMapAsset = testCase.url === "/" ? "/product/pmbok-comparison-ja.png" : "/product/pmbok-comparison-en.png";
      assert(result.realMap?.src.endsWith(expectedMapAsset), `${testCase.name}: wrong localized Map asset: ${result.realMap?.src ?? "missing"}`);
      assert(result.heroMapSrc === expectedMapAsset, `${testCase.name}: hero uses the wrong localized Map asset: ${result.heroMapSrc}`);
      assert(result.mapSourceHref === "https://pmbok.guide/", `${testCase.name}: PMBOK example attribution link is missing`);
      assert(!result.bodyText.includes("Cache invalidation"), `${testCase.name}: obsolete cache-invalidation marketing fixture leaked into the LP`);
      assert(result.hasCodexSection, `${testCase.name}: Codex architecture section is missing`);
      assert(result.installSteps === 4, `${testCase.name}: expected 4 installation steps, got ${result.installSteps}`);
      assert(result.faqItems >= 5, `${testCase.name}: FAQ is incomplete`);
      if (testCase.mobile) {
        assert(result.mobileLayout, `${testCase.name}: mobile layout metrics are unavailable`);
        assert(result.mobileLayout.heroColumns === 1, `${testCase.name}: hero did not collapse to one column`);
        assert(result.mobileLayout.principleColumns === 1, `${testCase.name}: principles did not collapse to one column`);
        assert(result.mobileLayout.codexColumns === 1, `${testCase.name}: Codex architecture did not collapse to one column`);
        assert(result.mobileLayout.installColumns === 1, `${testCase.name}: install steps did not collapse to one column`);
        assert(result.mobileLayout.footerColumns === 1, `${testCase.name}: footer did not collapse to one column`);
        assert(result.mobileLayout.desktopNavHidden, `${testCase.name}: desktop navigation remains visible on mobile`);
        assert(["auto", "scroll"].includes(result.mobileLayout.mapOverflowX), `${testCase.name}: real Map is not horizontally scrollable`);
        assert(result.mobileLayout.mapScrollWidth > result.mobileLayout.mapClientWidth, `${testCase.name}: real Map was shrunk instead of preserving readable scroll width`);
      }
      assert(
        testCase.url === "/" ? result.bodyText.includes("AIとのチャットは、あくまでサブ") : result.bodyText.includes("AI chat is deliberately secondary"),
        `${testCase.name}: chat-as-scratchpad positioning is missing`,
      );
      assert(consoleErrors.length === 0, `${testCase.name}: console errors: ${consoleErrors.join(" | ")}`);

      const suffix = configuredOrigin ? "-production" : "";
      await page.screenshot({ path: path.join(artifacts, `${testCase.name}${suffix}.png`), fullPage: captureFullPage });
      console.log(`[lp-e2e] ${configuredOrigin ? "production " : ""}${testCase.name}: ${result.title}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  }
}

console.log(`[lp-e2e] visual artifacts: ${path.relative(repoRoot, artifacts)} (${captureFullPage ? "full-page" : "viewport"})`);

/** Waits until either Astro Preview or the configured production origin is reachable. */
async function waitForServer(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The local preview or remote edge may still be becoming reachable.
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for Lensmap LP at ${url}\n${serverOutput}`);
}

/** Throws a readable acceptance error when a required LP invariant is not met. */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
