import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import type { Job } from "@/shared/contracts";
import { toCents } from "@/shared/money";
import { getDb, type ProofPayDb } from "@/server/db/client";
import { getJob, insertEvent, setLivenessCode, upsertPayment } from "@/server/db/repo";
import { transition } from "@/server/escrow/machine";
import { ConflictError, NotFoundError, ValidationError } from "@/server/http/errors";
import { ppFetchWithMeta } from "./client";

/** Orders v2 create + authorize (docs/MANUAL.md §10.3). */

export const HONOR_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;
const AUTHORIZATION_VALID_MS = 29 * 24 * 60 * 60 * 1000;
const MAX_DESCRIPTION = 127;

const AmountSchema = z.object({ currency_code: z.string(), value: z.string() });

const AuthorizationSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: AmountSchema.optional(),
  expiration_time: z.string().optional(),
});

/** Only the fields ProofPay reads; PayPal sends many more. */
const OrderSchema = z.object({
  id: z.string(),
  status: z.string(),
  purchase_units: z
    .array(
      z.object({
        reference_id: z.string().optional(),
        custom_id: z.string().optional(),
        amount: AmountSchema.optional(),
        payments: z
          .object({ authorizations: z.array(AuthorizationSchema).optional() })
          .optional(),
      }),
    )
    .min(1),
});
type Order = z.infer<typeof OrderSchema>;

function requireJob(jobId: string, db: ProofPayDb): Job {
  const job = getJob(jobId, db);
  if (!job) throw new NotFoundError("Job");
  return job;
}

/** Create a PayPal order with `intent: "AUTHORIZE"` for a job in `CREATED`. */
export async function createOrder(
  jobId: string,
  db: ProofPayDb = getDb(),
): Promise<{ orderId: string }> {
  const job = requireJob(jobId, db);
  if (job.status !== "CREATED") {
    throw new ConflictError(
      `This job is ${job.status}; a PayPal order can only be created while it is CREATED.`,
      "JOB_NOT_PAYABLE",
    );
  }
  const { data: order, debugId } = await ppFetchWithMeta("/v2/checkout/orders", {
    method: "POST",
    idempotencyKey: `${job.id}:create:1`,
    schema: OrderSchema,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: job.id,
          custom_id: job.id,
          description: job.title.slice(0, MAX_DESCRIPTION),
          amount: { currency_code: job.amount.currency, value: job.amount.value },
        },
      ],
    },
  });
  upsertPayment(job.id, { paypalOrderId: order.id }, db);
  insertEvent(
    {
      jobId: job.id,
      type: "PAYPAL_CALL",
      actor: "customer",
      data: { op: "create_order", orderId: order.id, status: order.status, debugId },
    },
    db,
  );
  return { orderId: order.id };
}

function firstAuthorization(order: Order) {
  return order.purchase_units[0]?.payments?.authorizations?.[0];
}

/**
 * Authorize an approved order: hold the funds, store the authorization,
 * generate the 4-digit liveness code and move the job to `AUTHORIZED`.
 * Calling it again for the same order returns the job unchanged.
 */
export async function authorizeOrder(
  orderId: string,
  jobId: string,
  db: ProofPayDb = getDb(),
): Promise<Job> {
  const job = requireJob(jobId, db);
  if (job.status !== "CREATED") {
    if (job.payment?.orderId === orderId && job.payment.authorizationId) return job;
    throw new ConflictError(
      `This job is ${job.status}; it can only be authorized while it is CREATED.`,
      "JOB_NOT_PAYABLE",
    );
  }

  const path = `/v2/checkout/orders/${encodeURIComponent(orderId)}`;
  const { data: existing } = await ppFetchWithMeta(path, { schema: OrderSchema });
  const unit = existing.purchase_units[0];
  if (unit?.custom_id !== job.id) {
    throw new ValidationError("This PayPal order belongs to a different job.", "ORDER_JOB_MISMATCH");
  }
  if (
    !unit.amount ||
    unit.amount.currency_code !== job.amount.currency ||
    toCents(unit.amount.value) !== toCents(job.amount.value)
  ) {
    throw new ValidationError(
      "The PayPal order amount does not match the job amount.",
      "ORDER_AMOUNT_MISMATCH",
    );
  }

  const { data: order, debugId } = await ppFetchWithMeta(`${path}/authorize`, {
    method: "POST",
    idempotencyKey: `${job.id}:authorize:1`,
    schema: OrderSchema,
    body: {},
  });
  const authorization = firstAuthorization(order);
  if (!authorization) {
    throw new ConflictError("PayPal returned no authorization for this order.", "NO_AUTHORIZATION");
  }
  if (authorization.status !== "CREATED") {
    insertEvent(
      {
        jobId: job.id,
        type: "PAYPAL_CALL",
        actor: "customer",
        data: { op: "authorize", orderId, status: authorization.status, debugId, ok: false },
      },
      db,
    );
    throw new ConflictError(
      `PayPal did not place the hold (authorization status ${authorization.status}).`,
      "AUTHORIZATION_NOT_CREATED",
    );
  }

  const now = Date.now();
  const amount = authorization.amount ?? unit.amount;
  upsertPayment(
    job.id,
    {
      paypalOrderId: order.id,
      authorizationId: authorization.id,
      authorizationStatus: authorization.status,
      authorizedCents: toCents(amount.value),
      authorizationExpiresAt:
        authorization.expiration_time ?? new Date(now + AUTHORIZATION_VALID_MS).toISOString(),
      // Computed: PayPal recommends capturing within 3 days of the authorization.
      honorPeriodEndsAt: new Date(now + HONOR_PERIOD_MS).toISOString(),
    },
    db,
  );
  setLivenessCode(job.id, String(randomInt(1000, 10000)), db);
  insertEvent(
    {
      jobId: job.id,
      type: "PAYPAL_CALL",
      actor: "customer",
      data: {
        op: "authorize",
        orderId: order.id,
        authorizationId: authorization.id,
        status: authorization.status,
        debugId,
        ok: true,
      },
    },
    db,
  );
  return transition(
    job.id,
    "AUTHORIZED",
    "customer",
    { orderId: order.id, authorizationId: authorization.id, amount: job.amount },
    db,
  );
}
