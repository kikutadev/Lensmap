#!/usr/bin/env node
/* global console, fetch, setTimeout, AbortSignal */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";

const root = process.cwd();
const manifestPath = resolve(
  homedir(),
  "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.deepreader.launcher.json",
);
const controllerPath = resolve(root, "scripts/deep-reader-server.mjs");
const healthUrl = "http://127.0.0.1:4317/api/health";

if (!existsSync(manifestPath)) {
  throw new Error(`Native Host manifest not installed: ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.equal(manifest.name, "com.deepreader.launcher");
assert.equal(manifest.type, "stdio");
assert(Array.isArray(manifest.allowed_origins) && manifest.allowed_origins.length === 1);
assert(existsSync(manifest.path), `Native Host executable not found: ${manifest.path}`);

const wasRunning = await isHealthy();
try {
  const response = await sendNativeMessage(manifest.path, { command: "ensure-server" });
  assert.equal(response.ok, true, response.message ?? "Native Host returned failure");
  assert(["already-running", "started"].includes(response.state));
  assert.equal(await waitForHealth(10_000), true, "Deep Reader Server did not become healthy");
  console.log(JSON.stringify({
    ok: true,
    state: response.state,
    manifestPath,
    hostPath: manifest.path,
    serverHealthy: true,
  }, null, 2));
} finally {
  if (!wasRunning) {
    spawnSync(process.execPath, [controllerPath, "stop"], {
      cwd: root,
      stdio: "ignore",
    });
  }
}

/** Exercise the installed executable using Chrome's 4-byte little-endian Native Messaging framing. */
function sendNativeMessage(executablePath, message) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executablePath, [], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      try {
        const buffer = Buffer.concat(chunks);
        assert(buffer.length >= 4, `Native Host produced no framed response. stderr=${Buffer.concat(stderr).toString("utf8")}`);
        const length = buffer.readUInt32LE(0);
        assert(buffer.length >= 4 + length, "Native Host response frame was truncated");
        const value = JSON.parse(buffer.subarray(4, 4 + length).toString("utf8"));
        if (code !== 0 && value?.ok !== false) {
          throw new Error(`Native Host exited with code ${code}: ${Buffer.concat(stderr).toString("utf8")}`);
        }
        resolvePromise(value);
      } catch (error) {
        reject(error);
      }
    });

    const body = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    child.stdin.end(Buffer.concat([header, body]));
  });
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy()) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return false;
}

async function isHealthy() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}
