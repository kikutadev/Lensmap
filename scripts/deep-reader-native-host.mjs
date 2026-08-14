#!/usr/bin/env node
/* global console, fetch, setTimeout, clearTimeout, AbortController */
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { readSync } from "node:fs";
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
    if (await isServerHealthy()) {
      return { ok: true, state: "already-running" };
    }

    await startServer();
    if (!(await isServerHealthy())) {
      throw new Error("Deep Reader Server startup command completed, but health check still fails.");
    }
    return { ok: true, state: "started" };
  }

  if (command === "status") {
    return {
      ok: true,
      state: (await isServerHealthy()) ? "already-running" : "stopped",
    };
  }

  throw new Error(`Unsupported Native Host command: ${command}`);
}

/** Reuse the production server controller so Native Messaging does not duplicate process-management logic. */
async function startServer() {
  try {
    await execFileAsync(process.execPath, [controllerPath, "start"], {
      cwd: projectRoot,
      env: process.env,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr ?? "").trim() : "";
    const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout ?? "").trim() : "";
    const detail = stderr || stdout || (error instanceof Error ? error.message : String(error));
    throw new Error(`Deep Reader Serverの起動に失敗しました: ${detail}`);
  }
}

async function isServerHealthy() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(healthUrl, { cache: "no-store", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
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
