#!/usr/bin/env node
// Production start for the hosted demo.
// Render's free tier has an ephemeral disk: with SEED_ON_BOOT=1 the SQLite
// database is recreated and the three demo jobs are seeded before `next start`.
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

if ((process.env.SEED_ON_BOOT ?? "0") === "1") {
  const tsx = binary("tsx");
  if (!existsSync(tsx)) {
    console.error(
      "[start] SEED_ON_BOOT=1 needs `tsx` (a runtime dependency for the seed). Run `npm ci` first.",
    );
    process.exit(1);
  }
  console.info("[start] SEED_ON_BOOT=1: resetting and seeding the demo database");
  const status = run(tsx, ["scripts/db-reset.ts"]);
  if (status !== 0) process.exit(status);
}

console.info(`[start] next start -p ${port}`);
const child = spawn(binary("next"), ["start", "-p", String(port)], {
  stdio: "inherit",
  cwd: projectRoot,
  env: process.env,
});

child.on("error", (error) => {
  console.error("[start] failed to launch next:", error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
