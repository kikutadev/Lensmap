import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dataDir = resolve(root, ".e2e-data");
const migrationsDir = resolve(root, "apps/server/drizzle");

rmSync(dataDir, { recursive: true, force: true });

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npmCommand, ["run", "dev"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    DEEP_READER_DATA_DIR: dataDir,
    DEEP_READER_MIGRATIONS_DIR: migrationsDir,
    DEEP_READER_HOST: "127.0.0.1",
    DEEP_READER_PORT: "4317",
  },
});

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null) child.kill(signal);
  setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 2_000).unref();
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
child.on("error", (error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
