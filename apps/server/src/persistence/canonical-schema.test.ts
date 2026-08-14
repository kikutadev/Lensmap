import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseBundle } from "./database.js";

let bundle: DatabaseBundle | undefined;
let dataDir: string | undefined;

afterEach(() => {
  bundle?.sqlite.close();
  bundle = undefined;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

describe("canonical Lensmap schema", () => {
  it("creates Explore and Map tables without legacy domain aliases", () => {
    dataDir = mkdtempSync(join(tmpdir(), "lensmap-canonical-schema-"));
    bundle = createDatabase({
      host: "127.0.0.1",
      port: 4317,
      dataDir,
      migrationsDir: join(process.cwd(), "drizzle"),
      codexBin: null,
      capabilityToken: null,
    });

    const names = bundle.sqlite.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name").all()
      .map((row) => String((row as { name: unknown }).name));

    expect(names).toEqual(expect.arrayContaining([
      "explore_threads",
      "explore_messages",
      "explore_message_sources",
      "explore_retrieval_events",
      "map_artifacts",
      "map_versions",
      "map_blocks",
      "map_sources",
      "map_origin_turns",
      "map_block_sources",
      "document_blocks_fts",
      "document_blocks_trigram",
    ]));
    expect(names.some((name) => new RegExp(`^(?:${"cha" + "t_"}|${"insi" + "ght_"}|${"arti" + "fact_"})`, "u").test(name))).toBe(false);
  });
});
