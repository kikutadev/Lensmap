import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("resolves production data and migration defaults from the server package rather than process.cwd()", () => {
    const config = loadConfig({});
    expect(config.dataDir).toMatch(/apps\/server\/data$/u);
    expect(config.migrationsDir).toMatch(/apps\/server\/drizzle$/u);
    expect(config.port).toBe(4317);
    expect(config.host).toBe("127.0.0.1");
    expect(config.capabilityToken).toBeNull();
    expect(config.visualOcrBin).toMatch(/native\/macos\/bin\/lensmap-ocr$/u);
  });

  it("honors explicit runtime paths", () => {
    const config = loadConfig({
      LENSMAP_DATA_DIR: "/tmp/lensmap-data",
      LENSMAP_MIGRATIONS_DIR: "/tmp/lensmap-migrations",
      LENSMAP_PORT: "5555",
      LENSMAP_HOST: "0.0.0.0",
      CODEX_BIN: "/tmp/codex",
      LENSMAP_OCR_BIN: "/tmp/lensmap-ocr",
      LENSMAP_CAPABILITY_TOKEN: "test-capability-token-that-is-long-enough-1234567890",
    });
    expect(config).toMatchObject({
      dataDir: "/tmp/lensmap-data",
      migrationsDir: "/tmp/lensmap-migrations",
      port: 5555,
      host: "0.0.0.0",
      codexBin: "/tmp/codex",
      visualOcrBin: "/tmp/lensmap-ocr",
      capabilityToken: "test-capability-token-that-is-long-enough-1234567890",
    });
  });

  it("rejects weak configured capability tokens", () => {
    expect(() => loadConfig({ LENSMAP_CAPABILITY_TOKEN: "too-short" })).toThrow(/at least 32 characters/u);
  });
});
