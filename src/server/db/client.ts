import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";

export type ProofPayDb = BetterSQLite3Database<typeof schema>;

export const DEFAULT_DATABASE_PATH = "./data/proofpay.db";

/**
 * Open (or create) the SQLite database at `databasePath` and return a Drizzle
 * handle. Pass `:memory:` for unit tests.
 */
export function createDb(databasePath?: string): ProofPayDb {
  const target = databasePath ?? getDatabasePath();
  const resolved =
    target === ":memory:" || target.startsWith("file:")
      ? target
      : resolve(process.cwd(), target);
  if (!resolved.startsWith(":memory:") && !resolved.startsWith("file:")) {
    mkdirSync(dirname(resolved), { recursive: true });
  }
  const sqlite = new Database(resolved);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export function getDatabasePath(): string {
  return process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH;
}

let singleton: ProofPayDb | null = null;

/** Process-wide singleton for app code (server components, route handlers). */
export function getDb(): ProofPayDb {
  if (!singleton) {
    singleton = createDb();
  }
  return singleton;
}

/** Test helper: drop the singleton (e.g. before pointing DATABASE_PATH somewhere else). */
export function resetDbForTests(): void {
  singleton = null;
}

/** Apply the committed migrations in `drizzle/` to an open database. */
export function runMigrations(
  db: ProofPayDb,
  migrationsFolder: string = resolve(process.cwd(), "drizzle"),
): void {
  migrate(db, { migrationsFolder });
}
