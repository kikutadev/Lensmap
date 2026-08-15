/* global console */
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { spawnSync } from "node:child_process";
import process from "node:process";

const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error("Usage: node scripts/run-extension-e2e.mjs <script> [...args]");
  process.exit(2);
}

const serverNode = process.execPath;
let browserNode = process.execPath;
let chromeBin = process.env.LENSMAP_CHROME_BIN ?? null;
const hostArch = platform() === "darwin"
  ? (spawnSync("/usr/sbin/sysctl", ["-n", "hw.optional.arm64"], { encoding: "utf8" }).stdout.trim() === "1" ? "arm64" : process.arch)
  : process.arch;
if (platform() === "darwin" && hostArch === "arm64" && process.arch !== "arm64") {
  const candidates = [process.env.LENSMAP_ARM64_NODE, "/opt/homebrew/bin/node"].filter(Boolean);
  const nativeNode = candidates.find((candidate) => existsSync(candidate));
  if (nativeNode) browserNode = nativeNode;
}

if (!chromeBin) {
  try {
    const puppeteer = (await import("puppeteer")).default;
    const pinnedChrome = await puppeteer.executablePath();
    if (pinnedChrome && existsSync(pinnedChrome)) chromeBin = pinnedChrome;
  } catch {
    // Fall back to chrome-launch.mjs resolving an installed system browser.
  }
}

const result = spawnSync(browserNode, [script, ...args], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: {
    ...process.env,
    LENSMAP_E2E_HEADLESS: process.env.LENSMAP_E2E_HEADLESS ?? "1",
    LENSMAP_SERVER_NODE: process.env.LENSMAP_SERVER_NODE ?? serverNode,
    ...(chromeBin ? { LENSMAP_CHROME_BIN: chromeBin } : {}),
  },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
