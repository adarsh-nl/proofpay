#!/usr/bin/env node
// Production start for the hosted demo. T15 extends this with SEED_ON_BOOT.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = process.env.PORT || "3000";
const nextBin = fileURLToPath(
  new URL("../node_modules/.bin/next", import.meta.url),
);

console.info(`[start] next start -p ${port}`);
const child = spawn(nextBin, ["start", "-p", String(port)], {
  stdio: "inherit",
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
