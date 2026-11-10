import { beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  runMigrations,
  type ProofPayDb,
} from "@/server/db/client";
import { getPaypalIdempotency } from "@/server/db/repo";
import { resetEnvCache } from "@/server/env";
import { resetPayPalMock } from "@/server/paypal/mock";
import { createPayout } from "@/server/paypal/payouts";

let db: ProofPayDb;

beforeEach(() => {
  process.env.PAYPAL_MOCK = "1";
  process.env.CURRENCY = "USD";
  resetEnvCache();
  resetPayPalMock();
  db = createDb(":memory:");
  runMigrations(db);
});

describe("createPayout (PAYPAL_MOCK=1)", () => {
  it("creates a single-item Payouts v1 batch for the worker", async () => {
    const payout = await createPayout({
      jobId: "job-payout-1",
      amountCents: 6000,
      receiverEmail: "worker@example.test",
      note: "T18 unit test",
      db,
    });
    expect(payout.batchId).toMatch(/^MOCK-PAYOUT-\d+$/);
    expect(payout.status).toBe("PENDING");
    expect(payout.response.batch_header.payout_batch_id).toBe(payout.batchId);
    expect(payout.response.batch_header.amount).toEqual({
      currency_code: "USD",
      value: "60.00",
    });
    // The deterministic request id is persisted for replay protection.
    expect(getPaypalIdempotency("job-payout-1:payout:1", db)?.responseJson).toContain(
      payout.batchId,
    );
  });

  it("replays the stored batch for the same (jobId, op, attempt)", async () => {
    const options = {
      jobId: "job-payout-2",
      amountCents: 9600,
      receiverEmail: "worker@example.test",
      db,
    };
    const first = await createPayout(options);
    const second = await createPayout(options);
    expect(second.batchId).toBe(first.batchId);
  });

  it("uses a distinct batch per attempt", async () => {
    const first = await createPayout({
      jobId: "job-payout-3",
      amountCents: 100,
      receiverEmail: "worker@example.test",
      attempt: 1,
      db,
    });
    const second = await createPayout({
      jobId: "job-payout-3",
      amountCents: 100,
      receiverEmail: "worker@example.test",
      attempt: 2,
      db,
    });
    expect(second.batchId).not.toBe(first.batchId);
  });

  it("validates the receiver email and the amount", async () => {
    await expect(
      createPayout({
        jobId: "job-payout-4",
        amountCents: 100,
        receiverEmail: "not-an-email",
        db,
      }),
    ).rejects.toThrow(/WORKER_SANDBOX_EMAIL/);
    await expect(
      createPayout({
        jobId: "job-payout-4",
        amountCents: 0,
        receiverEmail: "worker@example.test",
        db,
      }),
    ).rejects.toThrow(/positive integer/);
    await expect(
      createPayout({
        jobId: "job-payout-4",
        amountCents: -5,
        receiverEmail: "worker@example.test",
        db,
      }),
    ).rejects.toThrow(/positive integer/);
  });
});
