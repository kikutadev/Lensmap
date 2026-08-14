import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("resolves production data and migration defaults from the server package rather than process.cwd()", () => {
    const config = loadConfig({});
    expect(config.dataDir).toMatch(/apps\/server\/data$/u);
    expect(config.migrationsDir).toMatch(/apps\/server\/drizzle$/u);
    expect(config.port).toBe(4317);
    expect(config.host).toBe("127.0.0.1");
  });

  it("honors explicit runtime paths", () => {
    const config = loadConfig({
      DEEP_READER_DATA_DIR: "/tmp/deep-reader-data",
      DEEP_READER_MIGRATIONS_DIR: "/tmp/deep-reader-migrations",
      DEEP_READER_PORT: "5555",
      DEEP_READER_HOST: "0.0.0.0",
      CODEX_BIN: "/tmp/codex",
    });
    expect(config).toMatchObject({
      dataDir: "/tmp/deep-reader-data",
      migrationsDir: "/tmp/deep-reader-migrations",
      port: 5555,
      host: "0.0.0.0",
      codexBin: "/tmp/codex",
    });
  });
});
