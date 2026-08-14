#!/usr/bin/env node
/* global console */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const HOST_NAME = "com.deepreader.launcher";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const extensionManifestPath = resolve(projectRoot, "apps/chrome-extension/.output/chrome-mv3/manifest.json");
const hostScriptPath = resolve(projectRoot, "scripts/deep-reader-native-host.mjs");
const configuredDataDir = process.env.DEEP_READER_DATA_DIR ? resolve(process.env.DEEP_READER_DATA_DIR) : null;
const configuredRuntimeDir = process.env.DEEP_READER_RUNTIME_DIR ? resolve(process.env.DEEP_READER_RUNTIME_DIR) : null;
const configuredCodexBin = process.env.CODEX_BIN ? resolve(process.env.CODEX_BIN) : null;
const runtimeDir = resolve(homedir(), "Library/Application Support/DeepReader/native-host");
const wrapperPath = resolve(runtimeDir, "deep-reader-native-host");
const nativeManifestTargets = [
  {
    browser: "Google Chrome",
    manifestDir: resolve(homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts"),
  },
  {
    browser: "Google Chrome for Testing",
    manifestDir: resolve(homedir(), "Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts"),
  },
].map((target) => ({
  ...target,
  manifestPath: resolve(target.manifestDir, `${HOST_NAME}.json`),
}));
const command = process.argv[2] ?? "status";

if (platform() !== "darwin") {
  throw new Error("Deep Reader Native Host manager currently supports macOS only.");
}

switch (command) {
  case "install":
    install();
    break;
  case "uninstall":
    uninstall();
    break;
  case "status":
    status();
    break;
  default:
    console.error("Usage: node scripts/native-host-manager.mjs <install|uninstall|status>");
    process.exitCode = 2;
}

/** Install one thin Native Messaging launcher; it does not create a daemon or login item. */
function install() {
  const { extensionId } = readExtensionIdentity();
  if (!existsSync(hostScriptPath)) throw new Error(`Native Host implementation not found: ${hostScriptPath}`);

  mkdirSync(runtimeDir, { recursive: true });

  const wrapper = [
    "#!/bin/sh",
    `export DEEP_READER_PROJECT_ROOT=${shellQuote(projectRoot)}`,
    ...(configuredDataDir ? [`export DEEP_READER_DATA_DIR=${shellQuote(configuredDataDir)}`] : []),
    ...(configuredRuntimeDir ? [`export DEEP_READER_RUNTIME_DIR=${shellQuote(configuredRuntimeDir)}`] : []),
    ...(configuredCodexBin ? [`export CODEX_BIN=${shellQuote(configuredCodexBin)}`] : []),
    `exec ${shellQuote(process.execPath)} ${shellQuote(hostScriptPath)}`,
    "",
  ].join("\n");
  writeFileSync(wrapperPath, wrapper, "utf8");
  chmodSync(wrapperPath, 0o755);

  const manifest = {
    name: HOST_NAME,
    description: "Starts Deep Reader Server on demand from the Deep Reader Chrome extension.",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  for (const target of nativeManifestTargets) {
    mkdirSync(target.manifestDir, { recursive: true });
    writeFileSync(target.manifestPath, serialized, "utf8");
  }

  console.log(JSON.stringify({
    installed: true,
    hostName: HOST_NAME,
    extensionId,
    manifestTargets: nativeManifestTargets.map(({ browser, manifestPath }) => ({ browser, manifestPath })),
    wrapperPath,
    projectRoot,
    dataDir: configuredDataDir,
    runtimeDir: configuredRuntimeDir,
    codexBin: configuredCodexBin,
    daemonInstalled: false,
    loginItemInstalled: false,
  }, null, 2));
}

function uninstall() {
  for (const target of nativeManifestTargets) rmSync(target.manifestPath, { force: true });
  rmSync(wrapperPath, { force: true });
  console.log(JSON.stringify({
    installed: false,
    hostName: HOST_NAME,
    manifestTargets: nativeManifestTargets.map(({ browser, manifestPath }) => ({ browser, manifestPath })),
    wrapperPath,
  }, null, 2));
}

function status() {
  const identity = existsSync(extensionManifestPath) ? readExtensionIdentity() : null;
  const expectedOrigin = identity ? `chrome-extension://${identity.extensionId}/` : null;
  const targets = nativeManifestTargets.map(({ browser, manifestPath }) => {
    let installedManifest = null;
    if (existsSync(manifestPath)) {
      try {
        installedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch {
        installedManifest = { invalid: true };
      }
    }
    const originMatches = expectedOrigin
      ? Array.isArray(installedManifest?.allowed_origins) && installedManifest.allowed_origins.includes(expectedOrigin)
      : null;
    return {
      browser,
      installed: existsSync(manifestPath),
      originMatches,
      manifestPath,
    };
  });

  console.log(JSON.stringify({
    installed: existsSync(wrapperPath) && targets.every((target) => target.installed),
    hostName: HOST_NAME,
    extensionId: identity?.extensionId ?? null,
    targets,
    wrapperPath,
    projectRoot,
    dataDir: configuredDataDir,
    runtimeDir: configuredRuntimeDir,
    codexBin: configuredCodexBin,
    daemonInstalled: false,
    loginItemInstalled: false,
  }, null, 2));
}

/** Derive Chrome's extension ID from the public key embedded in the built manifest. */
function readExtensionIdentity() {
  if (!existsSync(extensionManifestPath)) {
    throw new Error(`Built extension manifest not found: ${extensionManifestPath}. Run the Chrome extension production build first.`);
  }
  const manifest = JSON.parse(readFileSync(extensionManifestPath, "utf8"));
  if (typeof manifest.key !== "string" || !manifest.key.trim()) {
    throw new Error("Built extension manifest has no fixed public key; Native Messaging requires a stable extension ID.");
  }
  const keyBytes = Buffer.from(manifest.key, "base64");
  const digest = createHash("sha256").update(keyBytes).digest().subarray(0, 16);
  const extensionId = [...digest]
    .map((byte) => `${String.fromCharCode(97 + (byte >> 4))}${String.fromCharCode(97 + (byte & 0x0f))}`)
    .join("");
  return { extensionId };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}
