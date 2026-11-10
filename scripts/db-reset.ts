/**
 * `npm run db:reset` — recreate the SQLite database from migrations and seed
 * the three demo jobs, clearing uploaded evidence files.
 */
import "./load-env";

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDb, getDatabasePath, runMigrations } from "../src/server/db/client";
import { seedDemoJobs } from "../src/server/db/seed";

function uploadDir(): string {
  return resolve(process.cwd(), process.env.UPLOAD_DIR || "./data/uploads");
}

function main(): void {
  const databasePath = resolve(process.cwd(), getDatabasePath());

  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${databasePath}${suffix}`;
    if (existsSync(file)) rmSync(file, { force: true });
  }

  const uploads = uploadDir();
  if (existsSync(uploads)) rmSync(uploads, { recursive: true, force: true });
  mkdirSync(dirname(databasePath), { recursive: true });
  mkdirSync(uploads, { recursive: true });

  const db = createDb(databasePath);
  runMigrations(db);
  const result = seedDemoJobs(db);

  console.info(
    `[db:reset] database=${databasePath} uploads=${uploads} seeded=${result.created.join(",") || "none"}`,
  );
  if (result.skipped.length > 0) {
    console.warn(`[db:reset] skipped existing jobs: ${result.skipped.join(",")}`);
  }
}

main();
