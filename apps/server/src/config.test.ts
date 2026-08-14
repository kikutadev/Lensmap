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
  });

  it("honors explicit runtime paths", () => {
    const config = loadConfig({
      DEEP_READER_DATA_DIR: "/tmp/deep-reader-data",
      DEEP_READER_MIGRATIONS_DIR: "/tmp/deep-reader-migrations",
      DEEP_READER_PORT: "5555",
      DEEP_READER_HOST: "0.0.0.0",
      CODEX_BIN: "/tmp/codex",
      DEEP_READER_CAPABILITY_TOKEN: "test-capability-token-that-is-long-enough-1234567890",
    });
    expect(config).toMatchObject({
      dataDir: "/tmp/deep-reader-data",
      migrationsDir: "/tmp/deep-reader-migrations",
      port: 5555,
      host: "0.0.0.0",
      codexBin: "/tmp/codex",
      capabilityToken: "test-capability-token-that-is-long-enough-1234567890",
    });
  });

  it("rejects weak configured capability tokens", () => {
    expect(() => loadConfig({ DEEP_READER_CAPABILITY_TOKEN: "too-short" })).toThrow(/at least 32 characters/u);
  });
});
