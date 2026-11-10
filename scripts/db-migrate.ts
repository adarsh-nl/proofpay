/**
 * Boot-time database preparation (`scripts/start.mjs`). Never deletes data:
 * applies the committed migrations (a no-op when they are already applied),
 * makes sure the upload folder exists, and seeds the three demo jobs only when
 * the database has no jobs at all (a fresh or wiped disk).
 */
import "./load-env";

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createDb, getDatabasePath, runMigrations } from "../src/server/db/client";
import { listJobs } from "../src/server/db/repo";
import { seedDemoJobs } from "../src/server/db/seed";

function main(): void {
  const databasePath = resolve(process.cwd(), getDatabasePath());
  const uploads = resolve(process.cwd(), process.env.UPLOAD_DIR || "./data/uploads");
  mkdirSync(uploads, { recursive: true });

  const db = createDb(databasePath);
  runMigrations(db);
  const jobs = listJobs(undefined, db).length;
  if (jobs === 0) seedDemoJobs(db);
  console.info(
    `[db:migrate] database=${databasePath} uploads=${uploads} jobs=${jobs === 0 ? "seeded 3 demo jobs" : jobs}`,
  );
}

main();
