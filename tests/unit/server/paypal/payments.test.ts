import { beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  runMigrations,
  type ProofPayDb,
} from "@/server/db/client";
import { getPaypalIdempotency } from "@/server/db/repo";
import { resetEnvCache } from "@/server/env";
import { ppFetch } from "@/server/paypal/client";
import {
  PAYPAL_ISSUE_MESSAGES,
  PayPalError,
  friendlyPayPalMessage,
} from "@/server/paypal/errors";
import { resetPayPalMock } from "@/server/paypal/mock";
import {
  captureAuthorization,
  getAuthorization,
  reauthorize,
  refundCapture,
  voidAuthorization,
} from "@/server/paypal/payments";

let db: ProofPayDb;

beforeEach(() => {
  process.env.PAYPAL_MOCK = "1";
  process.env.CURRENCY = "USD";
  resetEnvCache();
  resetPayPalMock();
  db = createDb(":memory:");
  runMigrations(db);
});

interface AuthorizedPayment {
  authorizationId: string;
  orderId: string;
  jobId: string;
}

/** Create + authorize a mock order, exactly like T04 will in the app. */
async function fundAuthorization(
  value = "100.00",
  jobId = "job-1",
): Promise<AuthorizedPayment> {
  const order = await ppFetch<{ id: string }>("/v2/checkout/orders", {
    method: "POST",
    body: {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: jobId,
          custom_id: jobId,
          description: "ProofPay test job",
          amount: { currency_code: "USD", value },
        },
      ],
    },
    idempotencyKey: `${jobId}:create:1`,
  });
  const authorized = await ppFetch<{
    purchase_units: Array<{
      payments: { authorizations: Array<{ id: string }> };
    }>;
  }>(`/v2/checkout/orders/${order.id}/authorize`, {
    method: "POST",
    body: {},
    idempotencyKey: `${jobId}:authorize:1`,
  });
  return {
    orderId: order.id,
    jobId,
    authorizationId: authorized.purchase_units[0].payments.authorizations[0].id,
  };
}

describe("captureAuthorization", () => {
  it("captures the full authorized amount with final_capture=true", async () => {
    const { authorizationId, jobId } = await fundAuthorization();
    const capture = await captureAuthorization(authorizationId, {
      jobId,
      invoiceId: `${jobId}-1`,
      noteToPayer: "Verified by ProofPay",
      db,
    });
    expect(capture.status).toBe("COMPLETED");
    expect(capture.final_capture).toBe(true);
    expect(capture.amount).toEqual({ currency_code: "USD", value: "100.00" });

    const authorization = await getAuthorization(authorizationId);
    expect(authorization.status).toBe("CAPTURED");
    expect(getPaypalIdempotency(`${jobId}:capture:1`, db)?.responseJson).toContain(
      capture.id,
    );
  });

  it("captures 80% of $100.00 as $80.00 and the mock releases the remainder", async () => {
    const { authorizationId, jobId } = await fundAuthorization("100.00");
    const capture = await captureAuthorization(authorizationId, {
      jobId,
      amountCents: 8000,
      invoiceId: `${jobId}-1`,
      db,
    });
    expect(capture.amount?.value).toBe("80.00");
    expect(capture.final_capture).toBe(true);

    // C7 assumption: after a final partial capture the authorization reports CAPTURED.
    const authorization = await getAuthorization(authorizationId);
    expect(authorization.status).toBe("CAPTURED");
  });

  it("rejects a capture above the authorized amount", async () => {
    const { authorizationId, jobId } = await fundAuthorization("100.00");
    await expect(
      captureAuthorization(authorizationId, {
        jobId,
        amountCents: 12000,
        invoiceId: `${jobId}-1`,
        db,
      }),
    ).rejects.toMatchObject({
      name: "PayPalError",
      issue: "MAX_CAPTURE_AMOUNT_EXCEEDED",
      status: 422,
    });
  });

  it("refuses a capture above authorizedCents before calling PayPal", async () => {
    const { authorizationId, jobId } = await fundAuthorization("100.00");
    await expect(
      captureAuthorization(authorizationId, {
        jobId,
        amountCents: 6000,
        authorizedCents: 5000,
        invoiceId: `${jobId}-1`,
        db,
      }),
    ).rejects.toBeInstanceOf(PayPalError);

    const authorization = await getAuthorization(authorizationId);
    expect(authorization.status).toBe("CREATED");
    expect(getPaypalIdempotency(`${jobId}:capture:1`, db)).toBeNull();
  });

  it("replays the stored capture for the same (jobId, op, attempt)", async () => {
    const { authorizationId, jobId } = await fundAuthorization("100.00");
    const options = {
      jobId,
      amountCents: 10000,
      invoiceId: `${jobId}-1`,
      db,
    };
    const first = await captureAuthorization(authorizationId, options);
    // A second real capture would 422 AUTHORIZATION_ALREADY_CAPTURED; replay must win.
    const second = await captureAuthorization(authorizationId, options);
    expect(second.id).toBe(first.id);
    expect(second.amount?.value).toBe("100.00");
  });
});

describe("voidAuthorization", () => {
  it("voids an uncaptured authorization", async () => {
    const { authorizationId, jobId } = await fundAuthorization();
    await voidAuthorization(authorizationId, { jobId, db });
    const authorization = await getAuthorization(authorizationId);
    expect(authorization.status).toBe("VOIDED");
    expect(getPaypalIdempotency(`${jobId}:void:1`, db)).not.toBeNull();
  });

  it("rejects voiding a captured authorization", async () => {
    const { authorizationId, jobId } = await fundAuthorization();
    await captureAuthorization(authorizationId, {
      jobId,
      amountCents: 8000,
      invoiceId: `${jobId}-1`,
      db,
    });
    await expect(
      voidAuthorization(authorizationId, { jobId, db }),
    ).rejects.toMatchObject({ issue: "CANNOT_BE_VOIDED", status: 422 });
  });

  it("rejects capturing a voided authorization", async () => {
    const { authorizationId, jobId } = await fundAuthorization();
    await voidAuthorization(authorizationId, { jobId, db });
    await expect(
      captureAuthorization(authorizationId, {
        jobId,
        invoiceId: `${jobId}-2`,
        db,
      }),
    ).rejects.toMatchObject({ issue: "AUTHORIZATION_VOIDED", status: 422 });
  });
});

describe("refundCapture", () => {
  it("supports partial and full refunds and rejects over-refunds", async () => {
    const { authorizationId, jobId } = await fundAuthorization("100.00");
    const capture = await captureAuthorization(authorizationId, {
      jobId,
      invoiceId: `${jobId}-1`,
      db,
    });

    const partial = await refundCapture(capture.id, {
      jobId,
      amountCents: 2000,
      noteToPayer: "Partial refund",
      db,
    });
    expect(partial.status).toBe("COMPLETED");
    expect(partial.amount?.value).toBe("20.00");

    const rest = await refundCapture(capture.id, {
      jobId,
      amountCents: 8000,
      attempt: 2,
      db,
    });
    expect(rest.amount?.value).toBe("80.00");

    await expect(
      refundCapture(capture.id, { jobId, amountCents: 100, attempt: 3, db }),
    ).rejects.toMatchObject({ issue: "CAPTURE_FULLY_REFUNDED" });
  });
});

describe("reauthorize", () => {
  it("returns a new authorization id and retires the old one", async () => {
    const { authorizationId, jobId } = await fundAuthorization("100.00");
    const next = await reauthorize(authorizationId, {
      jobId,
      amountCents: 8000,
      db,
    });
    expect(next.id).not.toBe(authorizationId);
    expect(next.status).toBe("CREATED");
    expect(next.amount?.value).toBe("80.00");
    expect((await getAuthorization(authorizationId)).status).toBe("VOIDED");
  });
});

describe("friendlyPayPalMessage", () => {
  it("maps known PayPal issues to user-facing copy", () => {
    const error = new PayPalError(422, "MAX_CAPTURE_AMOUNT_EXCEEDED", "debug-1");
    expect(friendlyPayPalMessage(error)).toBe(
      PAYPAL_ISSUE_MESSAGES.MAX_CAPTURE_AMOUNT_EXCEEDED,
    );
    expect(friendlyPayPalMessage(new PayPalError(422, "CANNOT_BE_VOIDED", "d"))).toContain(
      "already captured",
    );
  });

  it("falls back to the PayPal description and then to generic copy", () => {
    const described = new PayPalError(422, "SOMETHING_NEW", "d", {
      description: "PayPal says no",
    });
    expect(friendlyPayPalMessage(described)).toBe("PayPal says no");
    expect(friendlyPayPalMessage(new PayPalError(500, "UNKNOWN", "d"))).toContain(
      "could not complete",
    );
  });
});
