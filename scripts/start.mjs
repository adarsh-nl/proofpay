#!/usr/bin/env node
// Production start for the hosted demo.
// Render's free tier has an ephemeral disk: with SEED_ON_BOOT=1 the SQLite
// database is recreated and the three demo jobs are seeded before `next start`.
// Without it, migrations are applied on every boot so a fresh disk still works.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const port = process.env.PORT || "3000";

function binary(name) {
  return fileURLToPath(new URL(`../node_modules/.bin/${name}`, import.meta.url));
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: projectRoot,
    env: process.env,
  });
  if (result.error) {
    console.error(`[start] failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  return result.status ?? 1;
}

// Prepare the database before serving. Both paths need `tsx` (a runtime dependency).
// SEED_ON_BOOT=1: wipe and re-seed (hosted demo on an ephemeral disk).
// Otherwise: apply migrations and keep the data; a brand-new database gets the demo jobs.
const tsx = binary("tsx");
if (!existsSync(tsx)) {
  console.error("[start] `tsx` is missing. Run `npm ci` first.");
  process.exit(1);
}
const seedOnBoot = (process.env.SEED_ON_BOOT ?? "0") === "1";
console.info(
  seedOnBoot
    ? "[start] SEED_ON_BOOT=1: resetting and seeding the demo database"
    : "[start] preparing the database (migrations; existing data is kept)",
);
const prepared = run(tsx, [seedOnBoot ? "scripts/db-reset.ts" : "scripts/db-migrate.ts"]);
if (prepared !== 0) process.exit(prepared);

console.info(`[start] next start -p ${port}`);
const child = spawn(binary("next"), ["start", "-p", String(port)], {
  stdio: "inherit",
  cwd: projectRoot,
  env: process.env,
});

// Pass shutdown signals on, so the server (not just this wrapper) stops on a
// redeploy or Ctrl+C and the port is released.
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error("[start] failed to launch next:", error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  // The child is gone; exit with its code (128+n is the convention for a signal).
  process.exit(signal ? 143 : (code ?? 1));
});
