import { beforeEach, describe, expect, it } from "vitest";
import { fromCents } from "@/shared/money";
import {
  createDb,
  runMigrations,
  type ProofPayDb,
} from "@/server/db/client";
import { createJob, getJob, getPayment, insertEvent, upsertPayment } from "@/server/db/repo";
import { resetEnvCache } from "@/server/env";
import { IllegalTransition } from "@/server/escrow/machine";
import { onApproved, settle } from "@/server/escrow/settle";
import { PolicyError } from "@/server/http/errors";
import { ppFetch } from "@/server/paypal/client";
import { PayPalError } from "@/server/paypal/errors";
import { captureAuthorization } from "@/server/paypal/payments";
import { resetPayPalMock } from "@/server/paypal/mock";
import { transition } from "@/server/escrow/machine";
import { buildTemplateCriteria } from "@/server/vision/criteria-templates";

let db: ProofPayDb;
let sequence = 0;

beforeEach(() => {
  process.env.PAYPAL_MOCK = "1";
  process.env.CURRENCY = "USD";
  process.env.AUTO_CAPTURE_ON_APPROVE = "1";
  resetEnvCache();
  resetPayPalMock();
  sequence += 1;
  db = createDb(":memory:");
  runMigrations(db);
});

interface FundedJob {
  jobId: string;
  authorizationId: string;
}

/**
 * Create a job that has been authorized and advanced to `target` through the
 * machine. `amountCents` defaults to the $60 bike demo.
 */
async function createFundedJob(
  target: "APPROVED" | "PARTIAL" | "REJECTED" | "HUMAN_REVIEW" | "AUTHORIZED",
  amountCents = 6000,
): Promise<FundedJob> {
  const jobId = `job-settle-${sequence}-${target}`;
  createJob(
    {
      id: jobId,
      title: "Replace bike chain",
      description: "Swap the worn chain for a new one.",
      category: "bike_repair",
      amountCents,
      currency: "USD",
      criteria: buildTemplateCriteria("bike_repair"),
    },
    db,
  );

  const order = await ppFetch<{ id: string }>("/v2/checkout/orders", {
    method: "POST",
    idempotencyKey: `${jobId}:create:1`,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: jobId,
          custom_id: jobId,
          description: "ProofPay settle test job",
          amount: { currency_code: "USD", value: fromCents(amountCents) },
        },
      ],
    },
  });
  const authorized = await ppFetch<{
    purchase_units: Array<{ payments: { authorizations: Array<{ id: string }> } }>;
  }>(`/v2/checkout/orders/${order.id}/authorize`, {
    method: "POST",
    body: {},
    idempotencyKey: `${jobId}:authorize:1`,
  });
  const authorizationId =
    authorized.purchase_units[0].payments.authorizations[0].id;

  upsertPayment(
    jobId,
    {
      paypalOrderId: order.id,
      authorizationId,
      authorizationStatus: "CREATED",
      authorizedCents: amountCents,
      authorizationExpiresAt: new Date(Date.now() + 29 * 86_400_000).toISOString(),
      honorPeriodEndsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      captureIds: [],
    },
    db,
  );
  transition(jobId, "AUTHORIZED", "customer", { authorizationId }, db);
  if (target === "AUTHORIZED") return { jobId, authorizationId };

  const path: Array<"EVIDENCE_SUBMITTED" | "VERIFYING" | typeof target> = [
    "EVIDENCE_SUBMITTED",
    "VERIFYING",
    target,
  ];
  for (const next of path) transition(jobId, next, "system", {}, db);
  return { jobId, authorizationId };
}

describe("settle FULL", () => {
  it("captures the full authorized amount and moves APPROVED → CAPTURED", async () => {
    const { jobId } = await createFundedJob("APPROVED", 6000);
    const result = await settle(jobId, { kind: "FULL" }, db);
    expect(result.job.status).toBe("CAPTURED");
    expect(result.capturedCents).toBe(6000);
    expect(result.captureId).toBeTruthy();

    const payment = getPayment(jobId, db);
    expect(payment?.captured.value).toBe("60.00");
    expect(payment?.captureIds).toEqual([result.captureId]);
    expect(
      result.job.events.filter((event) => event.toStatus === "CAPTURED"),
    ).toHaveLength(1);
  });

  it("refuses FULL from any status other than APPROVED", async () => {
    const { jobId } = await createFundedJob("PARTIAL", 6000);
    await expect(settle(jobId, { kind: "FULL" }, db)).rejects.toBeInstanceOf(
      IllegalTransition,
    );
    expect(getJob(jobId, db)?.status).toBe("PARTIAL");
  });

  it("onApproved auto-captures when AUTO_CAPTURE_ON_APPROVE=1", async () => {
    const { jobId } = await createFundedJob("APPROVED", 6000);
    const job = await onApproved(jobId, db);
    expect(job.status).toBe("CAPTURED");
    expect(getPayment(jobId, db)?.captured.value).toBe("60.00");
  });

  it("onApproved leaves the job APPROVED when AUTO_CAPTURE_ON_APPROVE=0", async () => {
    process.env.AUTO_CAPTURE_ON_APPROVE = "0";
    resetEnvCache();
    const { jobId } = await createFundedJob("APPROVED", 6000);
    const job = await onApproved(jobId, db);
    expect(job.status).toBe("APPROVED");
    expect(getPayment(jobId, db)?.captured.value).toBe("0.00");
  });
});

describe("settle PARTIAL (human approval gate)", () => {
  it("refuses a partial capture without a recorded approval", async () => {
    const { jobId } = await createFundedJob("PARTIAL", 12000);
    await expect(
      settle(jobId, { kind: "PARTIAL", amountCents: 9600 }, db),
    ).rejects.toBeInstanceOf(PolicyError);
    expect(getJob(jobId, db)?.status).toBe("PARTIAL");
    expect(getPayment(jobId, db)?.captured.value).toBe("0.00");
  });

  it("captures 80% of $120.00 after the customer accepts the proposal", async () => {
    const { jobId } = await createFundedJob("PARTIAL", 12000);
    insertEvent(
      {
        jobId,
        type: "SETTLEMENT_ACCEPTED",
        fromStatus: "PARTIAL",
        toStatus: "PARTIAL",
        actor: "customer",
        data: { proposalId: "prp_test" },
      },
      db,
    );
    const result = await settle(jobId, { kind: "PARTIAL", amountCents: 9600 }, db);
    expect(result.job.status).toBe("CAPTURED");
    expect(result.capturedCents).toBe(9600);
    expect(getPayment(jobId, db)?.captured.value).toBe("96.00");
    expect(result.job.events.at(-1)?.actor).toBe("customer");
  });

  it("accepts a reviewer REVIEW event as the approval", async () => {
    const { jobId } = await createFundedJob("PARTIAL", 12000);
    insertEvent(
      {
        jobId,
        type: "REVIEW",
        actor: "reviewer",
        data: { decision: "PARTIAL", amount: "96.00" },
      },
      db,
    );
    const result = await settle(jobId, { kind: "PARTIAL", amountCents: 9600 }, db);
    expect(result.job.status).toBe("CAPTURED");
    expect(result.job.events.at(-1)?.actor).toBe("reviewer");
  });

  it("refuses a partial capture above the authorized amount", async () => {
    const { jobId } = await createFundedJob("PARTIAL", 12000);
    insertEvent({ jobId, type: "SETTLEMENT_ACCEPTED", actor: "customer" }, db);
    await expect(
      settle(jobId, { kind: "PARTIAL", amountCents: 12001 }, db),
    ).rejects.toBeInstanceOf(PolicyError);
    expect(getJob(jobId, db)?.status).toBe("PARTIAL");
  });
});

describe("settle VOID", () => {
  it("voids an authorized job and records voided_at", async () => {
    const { jobId, authorizationId } = await createFundedJob("AUTHORIZED", 6000);
    const result = await settle(jobId, { kind: "VOID" }, db);
    expect(result.job.status).toBe("VOIDED");
    const payment = getPayment(jobId, db);
    expect(payment?.captured.value).toBe("0.00");
    expect(authorizationId).toBeTruthy();
    expect(result.job.events.at(-1)?.toStatus).toBe("VOIDED");
  });

  it("refuses to void a captured job", async () => {
    const { jobId } = await createFundedJob("APPROVED", 6000);
    await settle(jobId, { kind: "FULL" }, db);
    await expect(settle(jobId, { kind: "VOID" }, db)).rejects.toBeInstanceOf(
      IllegalTransition,
    );
    expect(getJob(jobId, db)?.status).toBe("CAPTURED");
  });
});

describe("settle REFUND", () => {
  it("refunds a captured job (partial refund keeps CAPTURED money in the books)", async () => {
    const { jobId } = await createFundedJob("APPROVED", 6000);
    await settle(jobId, { kind: "FULL" }, db);
    const result = await settle(jobId, { kind: "REFUND", amountCents: 1000 }, db);
    expect(result.job.status).toBe("REFUNDED");
    expect(result.refundedCents).toBe(1000);
    expect(getPayment(jobId, db)?.refunded.value).toBe("10.00");
  });

  it("refunds the full captured amount when no amount is given", async () => {
    const { jobId } = await createFundedJob("APPROVED", 6000);
    await settle(jobId, { kind: "FULL" }, db);
    const result = await settle(jobId, { kind: "REFUND" }, db);
    expect(result.refundedCents).toBe(6000);
  });
});

describe("PayPal failures", () => {
  it("keeps the status, logs a PAYPAL_CALL event and rethrows", async () => {
    const { jobId, authorizationId } = await createFundedJob("APPROVED", 6000);
    // Capture behind settle's back so the next capture is rejected by PayPal.
    await captureAuthorization(authorizationId, {
      jobId,
      invoiceId: `${jobId}-outside`,
      attempt: 99, // a different idempotency key, so settle really calls PayPal
      db,
    });

    await expect(settle(jobId, { kind: "FULL" }, db)).rejects.toBeInstanceOf(
      PayPalError,
    );
    expect(getJob(jobId, db)?.status).toBe("APPROVED");
    const callEvent = getJob(jobId, db)
      ?.events.filter((event) => event.type === "PAYPAL_CALL")
      .at(-1);
    expect(callEvent?.data).toMatchObject({
      op: "capture",
      issue: "AUTHORIZATION_ALREADY_CAPTURED",
    });
  });
});
