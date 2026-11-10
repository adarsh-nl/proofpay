/**
 * LIVE-VERIFY experiment (T05, MANUAL §10.3):
 *   authorize $100 → capture $80 with `final_capture: true` → GET authorization
 *   (is the remaining $20 released?) → try void (which 422 does it return?).
 *
 * Run manually with REAL sandbox credentials in `.env.local`:
 *   npx tsx scripts/paypal-partial-capture-experiment.ts
 *
 * Never prints secrets — only order / authorization / capture ids, amounts,
 * statuses and PayPal error issue names. Record the observed result in the
 * verification log of docs/REFERENCES.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const CONDITION = "--conditions=react-server";

interface AuthorizeResponse {
  purchase_units: Array<{
    payments: {
      authorizations: Array<{ id: string; status: string }>;
    };
  }>;
}

async function main(): Promise<void> {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }

  const { getEnv } = await import("../src/server/env");
  if (getEnv().PAYPAL_MOCK) {
    console.log(
      "PAYPAL_MOCK=1: this experiment needs the real sandbox (mock mode makes no network calls).",
    );
    return;
  }

  const { ppFetch } = await import("../src/server/paypal/client");
  const { captureAuthorization, getAuthorization, voidAuthorization } =
    await import("../src/server/paypal/payments");

  const jobId = `experiment-partial-capture-${Date.now()}`;
  const order = await ppFetch<{
    id: string;
    links?: Array<{ href: string; rel: string }>;
  }>("/v2/checkout/orders", {
    method: "POST",
    idempotencyKey: `${jobId}:create:1`,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: jobId,
          custom_id: jobId,
          description: "ProofPay T05 partial-capture experiment",
          amount: { currency_code: "USD", value: "100.00" },
        },
      ],
    },
  });
  console.log(`[1] Order ${order.id} created with intent AUTHORIZE, amount $100.00.`);
  const approve = order.links?.find(
    (link) => link.rel === "approve" || link.rel === "payer-action",
  );
  if (approve) {
    console.log(`[2] Approve it as the sandbox buyer: ${approve.href}`);
  } else {
    console.log("[2] No approve link in the response; check the sandbox dashboard.");
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  await readline.question("[3] Press Enter after the order shows COMPLETED/approved...");
  readline.close();

  const authorized = await ppFetch<AuthorizeResponse>(
    `/v2/checkout/orders/${order.id}/authorize`,
    { method: "POST", body: {}, idempotencyKey: `${jobId}:authorize:1` },
  );
  const authorizationId =
    authorized.purchase_units[0].payments.authorizations[0].id;
  console.log(`[4] Authorization ${authorizationId} created.`);

  const capture = await captureAuthorization(authorizationId, {
    jobId,
    amountCents: 8000,
    invoiceId: `${jobId}-1`,
    noteToPayer: "T05 partial-capture experiment (80%)",
  });
  console.log(
    `[5] Captured ${capture.amount?.value} ${capture.amount?.currency_code} ` +
      `(final_capture=${String(capture.final_capture)}) capture id=${capture.id}`,
  );

  const authorization = await getAuthorization(authorizationId);
  console.log(
    `[6] GET authorization -> status=${authorization.status} ` +
      `amount=${authorization.amount?.value ?? "?"} ` +
      `(question: is the remaining $20.00 released?)`,
  );

  try {
    await voidAuthorization(authorizationId, { jobId, attempt: 2 });
    console.log("[7] Void after a final partial capture: unexpectedly succeeded.");
  } catch (error) {
    const issue = (error as { issue?: string }).issue;
    console.log(
      `[7] Void after a final partial capture failed: issue=${issue ?? String(error)}`,
    );
  }

  console.log(
    "[8] Paste the [5]/[6]/[7] lines into the verification log in docs/REFERENCES.md.",
  );
}

if (!process.execArgv.includes(CONDITION)) {
  // `server-only` only resolves to its empty module under the react-server condition.
  const result = spawnSync(
    process.execPath,
    [CONDITION, "--import", "tsx", fileURLToPath(import.meta.url)],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
} else {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Partial-capture experiment failed: ${message}`);
    process.exit(1);
  });
}
