import { existsSync } from "node:fs";
import { platform } from "node:os";

/** Resolve a real installed Chrome first so Puppeteer E2E does not depend on a separate browser cache. */
export function resolveChromeExecutable() {
  if (process.env.LENSMAP_CHROME_BIN && existsSync(process.env.LENSMAP_CHROME_BIN)) {
    return process.env.LENSMAP_CHROME_BIN;
  }

  const candidates = platform() === "darwin"
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      ]
    : platform() === "win32"
      ? [
          `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];

  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

/**
 * Launch production Chrome extension E2E in unified Chrome Headless by default.
 * Set LENSMAP_E2E_HEADLESS=0 only for an explicit visual/manual diagnostic run.
 */
export function extensionLaunchOptions(extensionPath, extraArgs = []) {
  const executablePath = resolveChromeExecutable();
  const headless = process.env.LENSMAP_E2E_HEADLESS !== "0";
  return {
    headless,
    pipe: true,
    enableExtensions: [extensionPath],
    ...(executablePath ? { executablePath } : {}),
    args: [
      "--no-first-run",
      "--disable-sync",
      "--disable-default-apps",
      "--disable-extensions-file-access-check",
      ...extraArgs,
    ],
  };
}
