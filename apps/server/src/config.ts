import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  migrationsDir: string;
  codexBin: string | null;
}

/** Resolve server configuration from environment variables with safe local defaults. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const rawPort = env.DEEP_READER_PORT ?? "4317";
  const port = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid DEEP_READER_PORT: ${rawPort}`);
  }

  return {
    host: env.DEEP_READER_HOST ?? "127.0.0.1",
    port,
    dataDir: resolve(env.DEEP_READER_DATA_DIR ?? resolve(packageRoot, "data")),
    migrationsDir: resolve(env.DEEP_READER_MIGRATIONS_DIR ?? resolve(packageRoot, "drizzle")),
    codexBin: env.CODEX_BIN ?? null,
  };
}
