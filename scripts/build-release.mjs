#!/usr/bin/env node
/* global console, fetch */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, platform } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = readJson(resolve(root, "package.json"));
const extensionPackage = readJson(resolve(root, "apps/chrome-extension/package.json"));
const serverPackage = readJson(resolve(root, "apps/server/package.json"));
const nodeVersion = readFileSync(resolve(root, ".node-version"), "utf8").trim();
const releaseVersion = String(rootPackage.version);
const target = "macos-arm64";
const bundleName = `Lensmap-${releaseVersion}-${target}`;
const outputDir = resolve(root, "release-dist");
const cacheDir = resolve(root, ".release-cache");
const bundleDir = resolve(outputDir, bundleName);
const archivePath = resolve(outputDir, `${bundleName}.zip`);
const checksumPath = `${archivePath}.sha256`;
const extensionArchivePath = resolve(outputDir, `Lensmap-Extension-${releaseVersion}-chrome.zip`);
const extensionChecksumPath = `${extensionArchivePath}.sha256`;
const skipCheck = process.argv.includes("--skip-check");

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

/** Build one curated, self-contained macOS Apple Silicon release bundle. */
async function main() {
  assertReleaseEnvironment();
  assertVersionsAligned();

  if (!skipCheck) runNpm(["run", "check"]);
  else runNpm(["run", "build:native"]);

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(bundleDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });

  copyPublicMetadata();
  copyApplicationPayload();
  copyServerRuntimeDependencies();
  await installBundledNodeRuntime();
  writeReleaseManifest();
  makeCommandsExecutable();
  selfTestBundle();
  createZip();
  createExtensionZip();
  writeChecksum(archivePath, checksumPath);
  writeChecksum(extensionArchivePath, extensionChecksumPath);

  console.log(JSON.stringify({
    version: releaseVersion,
    target,
    bundleDir,
    archivePath,
    checksumPath,
    extensionArchivePath,
    extensionChecksumPath,
    extensionPath: resolve(bundleDir, "apps/chrome-extension/.output/chrome-mv3"),
  }, null, 2));
}

function assertReleaseEnvironment() {
  if (platform() !== "darwin" || arch() !== "arm64") {
    throw new Error(`Release build currently supports macOS arm64 only; got ${platform()} ${arch()}.`);
  }
  if (process.versions.node !== nodeVersion) {
    throw new Error(`Release build must run with Node ${nodeVersion}; current runtime is ${process.versions.node}.`);
  }
}

function assertVersionsAligned() {
  for (const [name, manifest] of [["server", serverPackage], ["chrome-extension", extensionPackage]]) {
    if (manifest.version !== releaseVersion) {
      throw new Error(`${name} version ${manifest.version} does not match root release version ${releaseVersion}.`);
    }
  }
}

function copyPublicMetadata() {
  for (const name of ["README.md", "LICENSE", "PRIVACY.md", "SECURITY.md", "THIRD_PARTY_NOTICES.md"]) {
    copyFileOrDirectory(resolve(root, name), resolve(bundleDir, name));
  }
  copyFileOrDirectory(resolve(root, "assets/release/lensmap-icon-512.png"), resolve(bundleDir, "lensmap-icon-512.png"));
  for (const command of ["install.command", "uninstall.command", "status.command"]) {
    copyFileOrDirectory(resolve(root, "packaging/macos", command), resolve(bundleDir, command));
  }
}

function copyApplicationPayload() {
  const required = [
    ["apps/server/dist", "apps/server/dist"],
    ["apps/server/drizzle", "apps/server/drizzle"],
    ["apps/chrome-extension/.output/chrome-mv3", "apps/chrome-extension/.output/chrome-mv3"],
    ["scripts/lensmap-server.mjs", "scripts/lensmap-server.mjs"],
    ["scripts/lensmap-native-host.mjs", "scripts/lensmap-native-host.mjs"],
    ["scripts/native-host-manager.mjs", "scripts/native-host-manager.mjs"],
    ["native/macos/bin/lensmap-ocr", "native/macos/bin/lensmap-ocr"],
  ];
  for (const [source, destination] of required) {
    const sourcePath = resolve(root, source);
    if (!existsSync(sourcePath)) throw new Error(`Required release artifact is missing: ${source}`);
    copyFileOrDirectory(sourcePath, resolve(bundleDir, destination));
  }

  for (const workspace of ["shared", "visualization"]) {
    const sourceRoot = resolve(root, "packages", workspace);
    const destinationRoot = resolve(bundleDir, "node_modules/@lensmap", workspace);
    mkdirSync(destinationRoot, { recursive: true });
    copyFileOrDirectory(resolve(sourceRoot, "package.json"), resolve(destinationRoot, "package.json"));
    copyFileOrDirectory(resolve(sourceRoot, "dist"), resolve(destinationRoot, "dist"));
  }
}

/** Copy only the production dependency closure needed by the Local Server, not the development monorepo. */
function copyServerRuntimeDependencies() {
  const listing = runNpm([
    "ls", "--omit=dev", "--all", "--parseable", "--workspace", "@lensmap/server",
  ], { capture: true });
  const rootNodeModules = resolve(root, "node_modules");
  const dependencyPaths = listing.split("\n").map((value) => value.trim()).filter(Boolean);
  const copied = new Set();

  for (const dependencyPath of dependencyPaths) {
    if (!dependencyPath.startsWith(`${rootNodeModules}/`)) continue;
    const dependencyRelative = relative(rootNodeModules, dependencyPath);
    if (!isTopLevelNodeModulePath(dependencyRelative)) continue;
    if (dependencyRelative.startsWith("@lensmap/")) continue;
    if (copied.has(dependencyRelative)) continue;

    copyFileOrDirectory(dependencyPath, resolve(bundleDir, "node_modules", dependencyRelative));
    copied.add(dependencyRelative);
  }

  if (copied.size === 0) throw new Error("Server production dependency closure was empty.");
  console.log(`Copied ${copied.size} top-level runtime dependency packages.`);
}

async function installBundledNodeRuntime() {
  const archiveName = `node-v${nodeVersion}-darwin-arm64.tar.gz`;
  const distBase = `https://nodejs.org/dist/v${nodeVersion}`;
  const cachedArchive = resolve(cacheDir, archiveName);
  const checksumText = await downloadText(`${distBase}/SHASUMS256.txt`);
  const expected = checksumText
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.endsWith(`  ${archiveName}`))
    ?.split(/\s+/u)[0];
  if (!expected) throw new Error(`Node checksum was not found for ${archiveName}.`);

  if (!existsSync(cachedArchive) || sha256File(cachedArchive) !== expected) {
    const temporary = `${cachedArchive}.tmp-${process.pid}`;
    rmSync(temporary, { force: true });
    await downloadFile(`${distBase}/${archiveName}`, temporary);
    const actual = sha256File(temporary);
    if (actual !== expected) {
      rmSync(temporary, { force: true });
      throw new Error(`Node runtime checksum mismatch: expected ${expected}, got ${actual}.`);
    }
    renameSync(temporary, cachedArchive);
  }

  const extractedRoot = resolve(cacheDir, `node-v${nodeVersion}-darwin-arm64`);
  rmSync(extractedRoot, { recursive: true, force: true });
  run("/usr/bin/tar", ["-xzf", cachedArchive, "-C", cacheDir]);

  const runtimeRoot = resolve(bundleDir, "runtime/node");
  mkdirSync(resolve(runtimeRoot, "bin"), { recursive: true });
  copyFileOrDirectory(resolve(extractedRoot, "bin/node"), resolve(runtimeRoot, "bin/node"));
  copyFileOrDirectory(resolve(extractedRoot, "LICENSE"), resolve(runtimeRoot, "LICENSE"));
  chmodSync(resolve(runtimeRoot, "bin/node"), 0o755);
}

function writeReleaseManifest() {
  const manifest = readJson(resolve(bundleDir, "apps/chrome-extension/.output/chrome-mv3/manifest.json"));
  const release = {
    name: "Lensmap",
    version: releaseVersion,
    target,
    nodeVersion,
    chromeMinimumVersion: manifest.minimum_chrome_version ?? null,
    builtAt: new Date().toISOString(),
    dataDirectory: "~/Library/Application Support/Lensmap/data",
    installDirectory: "~/Library/Application Support/Lensmap/app",
  };
  writeFileSync(resolve(bundleDir, "release.json"), `${JSON.stringify(release, null, 2)}\n`, "utf8");
}

function makeCommandsExecutable() {
  for (const name of ["install.command", "uninstall.command", "status.command"]) {
    chmodSync(resolve(bundleDir, name), 0o755);
  }
  chmodSync(resolve(bundleDir, "native/macos/bin/lensmap-ocr"), 0o755);
}

/** Start and stop the packaged server with the bundled Node runtime to catch missing native/runtime files. */
function selfTestBundle() {
  const bundledNode = resolve(bundleDir, "runtime/node/bin/node");
  const controller = resolve(bundleDir, "scripts/lensmap-server.mjs");
  const testData = resolve(bundleDir, ".selftest-data");
  const testRuntime = resolve(bundleDir, ".selftest-runtime");
  const port = String(45_000 + Math.floor(Math.random() * 5_000));
  const env = {
    ...process.env,
    LENSMAP_DATA_DIR: testData,
    LENSMAP_RUNTIME_DIR: testRuntime,
    LENSMAP_PORT: port,
  };

  try {
    run(bundledNode, [controller, "start"], { cwd: bundleDir, env, timeout: 20_000 });
  } finally {
    run(bundledNode, [controller, "stop"], { cwd: bundleDir, env, timeout: 10_000, allowFailure: true });
    rmSync(testData, { recursive: true, force: true });
    rmSync(testRuntime, { recursive: true, force: true });
  }
}

function createZip() {
  rmSync(archivePath, { force: true });
  run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", bundleDir, archivePath], { timeout: 120_000 });
}

function createExtensionZip() {
  const extensionRoot = resolve(root, "apps/chrome-extension/.output/chrome-mv3");
  if (!existsSync(resolve(extensionRoot, "manifest.json"))) {
    throw new Error("Chrome extension production output is missing manifest.json");
  }
  rmSync(extensionArchivePath, { force: true });
  run("/usr/bin/zip", ["-qr", extensionArchivePath, "."], { cwd: extensionRoot, timeout: 120_000 });
}

function writeChecksum(filePath, destination) {
  const digest = sha256File(filePath);
  writeFileSync(destination, `${digest}  ${basename(filePath)}\n`, "utf8");
}

function runNpm(args, options = {}) {
  const npmPath = resolve(dirname(process.execPath), "npm");
  const env = {
    ...process.env,
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
  };
  return run(npmPath, args, { cwd: root, env, capture: Boolean(options.capture), timeout: 180_000 });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeout ?? 60_000,
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error && !options.allowFailure) throw result.error;
  if ((result.status ?? 1) !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
  return options.capture ? String(result.stdout ?? "") : "";
}

function copyFileOrDirectory(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, dereference: true, force: true });
}

function isTopLevelNodeModulePath(value) {
  const parts = value.split("/");
  return parts[0]?.startsWith("@") ? parts.length === 2 : parts.length === 1;
}

async function downloadText(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return await response.text();
}

async function downloadFile(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(destination, buffer);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
