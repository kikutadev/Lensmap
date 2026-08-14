#!/usr/bin/env node
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "native/macos/LensmapOCR.swift");
const output = resolve(root, "native/macos/bin/lensmap-ocr");
mkdirSync(dirname(output), { recursive: true });

const result = spawnSync("/usr/bin/xcrun", [
  "swiftc",
  source,
  "-O",
  "-framework", "Vision",
  "-framework", "AppKit",
  "-o", output,
], { cwd: root, encoding: "utf8", stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`swiftc failed with exit code ${result.status}`);
chmodSync(output, 0o755);
process.stdout.write(`${output}\n`);
