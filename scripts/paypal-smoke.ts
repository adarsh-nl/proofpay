/**
 * PayPal sandbox smoke test: `npx tsx scripts/paypal-smoke.ts`.
 * Prints one line and never the token. Reads `.env.local` if present.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CONDITION = "--conditions=react-server";

async function main(): Promise<void> {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
  const { getEnv } = await import("../src/server/env");
  const { getAccessToken, tokenExpiresInSeconds } = await import("../src/server/paypal/client");
  if (getEnv().PAYPAL_MOCK) {
    console.log("PayPal MOCK mode (no network)");
    return;
  }
  await getAccessToken();
  console.log(`PayPal sandbox token OK (expires in ${tokenExpiresInSeconds()}s)`);
}

if (!process.execArgv.includes(CONDITION)) {
  // `server-only` resolves to an empty module only under the react-server condition.
  const result = spawnSync(
    process.execPath,
    [CONDITION, "--import", "tsx", fileURLToPath(import.meta.url)],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
} else {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`PayPal smoke test failed: ${message}`);
    process.exit(1);
  });
}
