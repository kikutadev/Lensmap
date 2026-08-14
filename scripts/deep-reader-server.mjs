/* global console, AbortController, setTimeout, clearTimeout, fetch */
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = resolve(process.env.DEEP_READER_RUNTIME_DIR ?? resolve(root, ".runtime"));
const pidFile = resolve(runtimeDir, "server.pid");
const logFile = resolve(runtimeDir, "server.log");
const capabilityTokenFile = resolve(runtimeDir, "capability-token");
const serverEntry = resolve(root, "apps/server/dist/index.js");
const dataDir = resolve(process.env.DEEP_READER_DATA_DIR ?? resolve(root, "apps/server/data"));
const migrationsDir = resolve(root, "apps/server/drizzle");
const host = process.env.DEEP_READER_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.DEEP_READER_PORT ?? "4317", 10);
const serverBase = `http://${host}:${port}/api`;
const command = process.argv[2] ?? "status";

mkdirSync(runtimeDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });

switch (command) {
  case "start":
    await start();
    break;
  case "stop":
    await stop();
    break;
  case "restart":
    await stop();
    await start();
    break;
  case "status":
    await status();
    break;
  default:
    console.error("Usage: node scripts/deep-reader-server.mjs <start|stop|restart|status>");
    process.exitCode = 2;
}

async function start() {
  const currentPid = readPid();
  if (currentPid && isRunning(currentPid)) {
    console.log(`Deep Reader Server is already running (pid ${currentPid}).`);
    await status();
    return;
  }

  if (!existsSync(serverEntry)) {
    throw new Error("Production server build not found. Run `npm run build -w @deep-reader/server` first.");
  }
  if (!existsSync(resolve(migrationsDir, "meta/_journal.json"))) {
    throw new Error(`Migration journal not found: ${resolve(migrationsDir, "meta/_journal.json")}`);
  }

  const codexBin = resolveCodexBin();
  const capabilityToken = rotateCapabilityToken();
  const logFd = openSync(logFile, "a");
  const child = spawn(process.execPath, [serverEntry], {
    cwd: root,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      DEEP_READER_HOST: host,
      DEEP_READER_PORT: String(port),
      DEEP_READER_DATA_DIR: dataDir,
      DEEP_READER_MIGRATIONS_DIR: migrationsDir,
      ...(codexBin ? { CODEX_BIN: codexBin } : {}),
      DEEP_READER_CAPABILITY_TOKEN: capabilityToken,
    },
  });
  child.unref();
  writeFileSync(pidFile, `${child.pid}\n`, "utf8");

  const ready = await waitForHealth(8_000);
  if (!ready) {
    const log = existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").slice(-30).join("\n") : "";
    throw new Error(`Deep Reader Server failed to start.\n${log}`);
  }
  console.log(`Deep Reader Server started (pid ${child.pid}) at ${serverBase}.`);
  await status();
}

async function stop() {
  const pid = readPid();
  if (!pid || !isRunning(pid)) {
    rmSync(pidFile, { force: true });
    console.log("Deep Reader Server is not running.");
    return;
  }

  process.kill(pid, "SIGTERM");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!isRunning(pid)) break;
    await delay(100);
  }
  if (isRunning(pid)) process.kill(pid, "SIGKILL");
  rmSync(pidFile, { force: true });
  rmSync(capabilityTokenFile, { force: true });
  console.log("Deep Reader Server stopped.");
}

async function status() {
  const pid = readPid();
  const capabilityToken = readCapabilityToken();
  const health = await fetchJson(`${serverBase}/health`, 2_000);
  const codex = health ? await fetchJson(`${serverBase}/codex/status`, 4_000, capabilityToken) : null;
  console.log(JSON.stringify({
    running: Boolean(health),
    pid: pid && isRunning(pid) ? pid : null,
    serverBase,
    health,
    codex: codex ? {
      ready: codex.ready,
      accountType: codex.account?.type ?? null,
      planType: codex.account?.planType ?? null,
      defaultModel: codex.models?.find((model) => model.isDefault)?.id ?? null,
      error: codex.error ?? null,
    } : null,
    capabilityProtected: Boolean(health?.capabilityRequired),
    capabilityAvailable: Boolean(capabilityToken),
    logFile,
  }, null, 2));
  if (!health) process.exitCode = 1;
}


/** Rotate the production loopback capability on each server process start. */
function rotateCapabilityToken() {
  const token = randomBytes(32).toString("base64url");
  writeFileSync(capabilityTokenFile, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(capabilityTokenFile, 0o600);
  return token;
}

/** Read the current capability without ever printing it to stdout or logs. */
function readCapabilityToken() {
  if (!existsSync(capabilityTokenFile)) return null;
  const token = readFileSync(capabilityTokenFile, "utf8").trim();
  return token || null;
}

function resolveCodexBin() {
  const pathCandidates = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, "codex"));
  const candidates = [
    process.env.CODEX_BIN,
    ...pathCandidates,
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

function readPid() {
  if (!existsSync(pidFile)) return null;
  const value = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fetchJson(`${serverBase}/health`, 500)) return true;
    await delay(100);
  }
  return false;
}

async function fetchJson(url, timeoutMs, capabilityToken = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      ...(capabilityToken ? { headers: { authorization: `Bearer ${capabilityToken}` } } : {}),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
