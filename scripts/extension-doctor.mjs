/* global console */
import { platform } from "node:os";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { resolveChromeExecutable } from "../e2e/chrome-launch.mjs";

const chrome = resolveChromeExecutable();
const hostArch = platform() === "darwin"
  ? (spawnSync("/usr/sbin/sysctl", ["-n", "hw.optional.arm64"], { encoding: "utf8" }).stdout.trim() === "1" ? "arm64" : process.arch)
  : process.arch;
const nativeMismatch = platform() === "darwin" && hostArch === "arm64" && process.arch !== "arm64";
console.log(JSON.stringify({
  host: `${platform()} ${hostArch}`,
  node: process.version,
  nodeArch: process.arch,
  chrome,
  preferredProjectNode: "22.23.2",
  extensionE2EHeadlessDefault: true,
  headedOverride: "DEEP_READER_E2E_HEADLESS=0",
  e2eNativeNodeFallback: nativeMismatch ? "/opt/homebrew/bin/node (when available)" : null,
  serverBase: process.env.DEEP_READER_SERVER_BASE ?? "http://127.0.0.1:4317/api",
}, null, 2));
if (!chrome) {
  console.error("Chrome executable was not found. Set DEEP_READER_CHROME_BIN or install Google Chrome.");
  process.exitCode = 1;
}
