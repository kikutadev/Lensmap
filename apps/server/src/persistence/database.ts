import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { AppConfig } from "../config.js";
import * as schema from "./schema.js";

export type AppDatabase = ReturnType<typeof createDatabase>["db"];
export type DatabaseBundle = ReturnType<typeof createDatabase>;

/** Open the local SQLite database, apply migrations, and enable durability/safety pragmas. */
export function createDatabase(config: AppConfig) {
  mkdirSync(config.dataDir, { recursive: true });
  const sqlite = new Database(join(config.dataDir, "lensmap.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: config.migrationsDir });

  return { sqlite, db };
}
