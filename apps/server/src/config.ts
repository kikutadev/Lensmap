import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  migrationsDir: string;
  codexBin: string | null;
  visualOcrBin?: string | null;
  capabilityToken?: string | null;
}

/** Resolve server configuration from environment variables with safe local defaults. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const rawPort = env.LENSMAP_PORT ?? "4317";
  const port = Number.parseInt(rawPort, 10);
  const capabilityToken = env.LENSMAP_CAPABILITY_TOKEN?.trim() || null;

  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid LENSMAP_PORT: ${rawPort}`);
  }
  if (capabilityToken && capabilityToken.length < 32) {
    throw new Error("LENSMAP_CAPABILITY_TOKEN must be at least 32 characters when configured");
  }

  return {
    host: env.LENSMAP_HOST ?? "127.0.0.1",
    port,
    dataDir: resolve(env.LENSMAP_DATA_DIR ?? resolve(packageRoot, "data")),
    migrationsDir: resolve(env.LENSMAP_MIGRATIONS_DIR ?? resolve(packageRoot, "drizzle")),
    codexBin: env.CODEX_BIN ?? null,
    visualOcrBin: resolve(env.LENSMAP_OCR_BIN ?? resolve(packageRoot, "../../native/macos/bin/lensmap-ocr")),
    capabilityToken,
  };
}
