/* global console, AbortController, setTimeout, clearTimeout, fetch */
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = resolve(root, ".runtime");
const pidFile = resolve(runtimeDir, "server.pid");
const logFile = resolve(runtimeDir, "server.log");
const serverEntry = resolve(root, "apps/server/dist/index.js");
const dataDir = resolve(root, "apps/server/data");
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
  console.log("Deep Reader Server stopped.");
}

async function status() {
  const pid = readPid();
  const health = await fetchJson(`${serverBase}/health`, 2_000);
  const codex = health ? await fetchJson(`${serverBase}/codex/status`, 4_000) : null;
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
    logFile,
  }, null, 2));
  if (!health) process.exitCode = 1;
}

function resolveCodexBin() {
  if (process.env.CODEX_BIN && existsSync(process.env.CODEX_BIN)) return process.env.CODEX_BIN;
  const chatGptCodex = "/Applications/ChatGPT.app/Contents/Resources/codex";
  if (existsSync(chatGptCodex)) return chatGptCodex;
  return undefined;
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

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
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
