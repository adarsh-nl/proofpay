import "server-only";

import { z } from "zod";
import { fromCents } from "@/shared/money";
import type { ProofPayDb } from "@/server/db/client";
import { withPaypalIdempotency } from "@/server/escrow/idempotency";
import { getEnv } from "@/server/env";
import { ppFetch } from "./client";

/**
 * Payouts v1 — stretch T18 (docs/MANUAL.md §10.5).
 *
 * After a verified job is CAPTURED, the worker can be paid from the captured
 * amount with `POST /v1/payments/payouts` to their sandbox account email.
 * Off by default (`PAYOUTS_ENABLED=0`); the caller (settle) decides.
 *
 * This is a **simulated** worker payout for the sandbox demo: real payouts need
 * the Payouts feature enabled on the PayPal sandbox app (LIVE-VERIFY).
 */

const LinkSchema = z.object({
  href: z.string(),
  rel: z.string(),
  method: z.string().optional(),
});

export const PayoutBatchHeaderSchema = z.object({
  payout_batch_id: z.string(),
  batch_status: z.string(),
  sender_batch_id: z.string().optional(),
  time_created: z.string().optional(),
  amount: z
    .object({ currency_code: z.string(), value: z.string() })
    .optional(),
});
export type PayoutBatchHeader = z.infer<typeof PayoutBatchHeaderSchema>;

export const PayoutResponseSchema = z.object({
  batch_header: PayoutBatchHeaderSchema,
  links: z.array(LinkSchema).optional(),
});
export type PayoutResponse = z.infer<typeof PayoutResponseSchema>;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface CreatePayoutOptions {
  /** Job the payout belongs to; keys the idempotency row. */
  jobId: string;
  /** Amount paid to the worker, in integer cents (never more than captured). */
  amountCents: number;
  currency?: string;
  /** The worker's PayPal sandbox account email (`WORKER_SANDBOX_EMAIL`). */
  receiverEmail: string;
  note?: string;
  attempt?: number;
  db?: ProofPayDb;
}

export interface Payout {
  batchId: string;
  status: string;
  response: PayoutResponse;
}

/**
 * Create a Payouts v1 batch with a single item (the worker). Idempotent via
 * `withPaypalIdempotency` (key `jobId:payout:attempt`).
 */
export async function createPayout(options: CreatePayoutOptions): Promise<Payout> {
  const receiverEmail = options.receiverEmail.trim();
  if (!EMAIL_RE.test(receiverEmail)) {
    throw new Error(
      `[payouts] WORKER_SANDBOX_EMAIL is not a valid sandbox email: ${JSON.stringify(receiverEmail)}`,
    );
  }
  if (!Number.isInteger(options.amountCents) || options.amountCents <= 0) {
    throw new Error(
      `[payouts] payout amount must be a positive integer amount of cents, got ${options.amountCents}`,
    );
  }
  const currency = options.currency ?? getEnv().CURRENCY;
  const attempt = options.attempt ?? 1;
  const senderBatchId = `${options.jobId}-${attempt}`;
  const amount = fromCents(options.amountCents);

  const body = {
    sender_batch_header: {
      sender_batch_id: senderBatchId,
      email_subject: "ProofPay: your work was verified",
      email_message:
        "The customer's payment was verified by ProofPay and your payout has been released (sandbox demo).",
    },
    items: [
      {
        recipient_type: "EMAIL",
        amount: { value: amount, currency },
        receiver: receiverEmail,
        note: options.note ?? "ProofPay worker payout (sandbox simulation)",
        sender_item_id: senderBatchId,
      },
    ],
  };

  const { data } = await withPaypalIdempotency(
    { jobId: options.jobId, op: "payout", attempt, db: options.db },
    (requestId) =>
      ppFetch<PayoutResponse>("/v1/payments/payouts", {
        method: "POST",
        body,
        idempotencyKey: requestId,
        schema: PayoutResponseSchema,
      }),
  );

  return {
    batchId: data.batch_header.payout_batch_id,
    status: data.batch_header.batch_status,
    response: data,
  };
}
