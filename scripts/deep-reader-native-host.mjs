#!/usr/bin/env node
/* global console, fetch, setTimeout, clearTimeout, AbortController */
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = process.env.DEEP_READER_PROJECT_ROOT
  ? resolve(process.env.DEEP_READER_PROJECT_ROOT)
  : resolve(scriptDir, "..");
const controllerPath = resolve(projectRoot, "scripts/deep-reader-server.mjs");
const runtimeDir = resolve(process.env.DEEP_READER_RUNTIME_DIR ?? resolve(projectRoot, ".runtime"));
const capabilityTokenPath = resolve(runtimeDir, "capability-token");
const host = process.env.DEEP_READER_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.DEEP_READER_PORT ?? "4317", 10);
const healthUrl = `http://${host}:${port}/api/health`;
const MAX_MESSAGE_BYTES = 1024 * 1024;

try {
  const request = readNativeMessage();
  const response = await handleRequest(request);
  writeNativeMessage(response);
} catch (error) {
  console.error("Deep Reader Native Host:", error);
  writeNativeMessage({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}

/** Handle the deliberately small native-host command surface. */
async function handleRequest(request) {
  if (!request || typeof request !== "object" || !("command" in request)) {
    throw new Error("Native Host request is missing command.");
  }

  const command = String(request.command);
  if (command === "ensure-server") {
    const health = await getServerHealth();
    const currentCapability = readCapabilityToken();

    // Upgrade a legacy/unprotected process or recover when the capability file was lost.
    if (health && (!health.capabilityRequired || !currentCapability)) {
      await runServerController("restart");
    } else if (!health) {
      await runServerController("start");
    }

    const securedHealth = await getServerHealth();
    if (!securedHealth) {
      throw new Error("Deep Reader Server startup command completed, but health check still fails.");
    }
    if (!securedHealth.capabilityRequired) {
      throw new Error("Deep Reader Server is running without local capability protection.");
    }

    const capabilityToken = readCapabilityToken();
    if (!capabilityToken) {
      throw new Error("Deep Reader Server capability token is unavailable.");
    }

    return {
      ok: true,
      state: health?.capabilityRequired && currentCapability ? "already-running" : "started",
      capabilityToken,
    };
  }

  if (command === "status") {
    const health = await getServerHealth();
    return {
      ok: true,
      state: health ? "already-running" : "stopped",
      capabilityProtected: Boolean(health?.capabilityRequired),
      capabilityAvailable: Boolean(readCapabilityToken()),
    };
  }

  throw new Error(`Unsupported Native Host command: ${command}`);
}

/** Reuse the production server controller so Native Messaging does not duplicate process-management logic. */
async function runServerController(command) {
  try {
    await execFileAsync(process.execPath, [controllerPath, command], {
      cwd: projectRoot,
      env: process.env,
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr ?? "").trim() : "";
    const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout ?? "").trim() : "";
    const detail = stderr || stdout || (error instanceof Error ? error.message : String(error));
    throw new Error(`Deep Reader Serverの${command}に失敗しました: ${detail}`);
  }
}

async function getServerHealth() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(healthUrl, { cache: "no-store", signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Read the capability from its owner-only runtime file without logging it. */
function readCapabilityToken() {
  if (!existsSync(capabilityTokenPath)) return null;
  const token = readFileSync(capabilityTokenPath, "utf8").trim();
  return token || null;
}

/** Read exactly one Chrome Native Messaging frame from stdin. */
function readNativeMessage() {
  const header = Buffer.alloc(4);
  readExactly(0, header);
  const length = header.readUInt32LE(0);
  if (length <= 0 || length > MAX_MESSAGE_BYTES) {
    throw new Error(`Invalid Native Messaging payload length: ${length}`);
  }
  const body = Buffer.alloc(length);
  readExactly(0, body);
  return JSON.parse(body.toString("utf8"));
}

/** Write exactly one Chrome Native Messaging frame to stdout; stdout must contain no other bytes. */
function writeNativeMessage(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function readExactly(fd, target) {
  let offset = 0;
  while (offset < target.length) {
    const bytesRead = readSync(fd, target, offset, target.length - offset, null);
    if (bytesRead === 0) throw new Error("Native Messaging input closed unexpectedly.");
    offset += bytesRead;
  }
}
