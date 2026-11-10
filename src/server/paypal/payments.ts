import "server-only";

import { z } from "zod";
import { getEnv } from "@/server/env";
import type { ProofPayDb } from "@/server/db/client";
import { withPaypalIdempotency } from "@/server/escrow/idempotency";
import { fromCents } from "@/shared/money";
import { ppFetch } from "./client";
import { PAYPAL_ISSUE_MESSAGES, PayPalError } from "./errors";

/**
 * Payments v2 operations (docs/MANUAL.md §10.3): capture (full/partial, always
 * `final_capture: true`), void, reauthorize, refund and get-authorization.
 *
 * Every write goes through `withPaypalIdempotency`, so the same
 * `(jobId, op, attempt)` can never move money twice.
 */

export const PayPalAmountSchema = z.object({
  currency_code: z.string(),
  value: z.string(),
});
export type PayPalAmount = z.infer<typeof PayPalAmountSchema>;

const LinkSchema = z.object({
  href: z.string(),
  rel: z.string(),
  method: z.string().optional(),
});

export const AuthorizationSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: PayPalAmountSchema.optional(),
  expiration_time: z.string().optional(),
  create_time: z.string().optional(),
  links: z.array(LinkSchema).optional(),
});
export type Authorization = z.infer<typeof AuthorizationSchema>;

export const CaptureSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: PayPalAmountSchema.optional(),
  final_capture: z.boolean().optional(),
  invoice_id: z.string().optional(),
  create_time: z.string().optional(),
  links: z.array(LinkSchema).optional(),
});
export type Capture = z.infer<typeof CaptureSchema>;

export const RefundSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: PayPalAmountSchema.optional(),
  create_time: z.string().optional(),
  links: z.array(LinkSchema).optional(),
});
export type Refund = z.infer<typeof RefundSchema>;

export interface PaymentsContext {
  /** Job the money belongs to; keys the idempotency row. */
  jobId: string;
  /** Retry counter for the same logical operation (default 1). */
  attempt?: number;
  /** Test seam; defaults to the app singleton. */
  db?: ProofPayDb;
}

export interface CaptureOptions extends PaymentsContext {
  /** Omit for a full capture of the authorized amount. */
  amountCents?: number;
  currency?: string;
  invoiceId: string;
  noteToPayer?: string;
  /**
   * When supplied, the capture is refused client-side if it would exceed the
   * authorized amount (belt and braces with PayPal's own 422).
   */
  authorizedCents?: number;
}

function amountBody(
  amountCents: number,
  currency: string,
): PayPalAmount {
  return { currency_code: currency, value: fromCents(amountCents) };
}

function checkAmount(
  amountCents: number | undefined,
  authorizedCents: number | undefined,
  currency: string,
): void {
  if (
    amountCents !== undefined &&
    authorizedCents !== undefined &&
    amountCents > authorizedCents
  ) {
    throw new PayPalError(422, "MAX_CAPTURE_AMOUNT_EXCEEDED", undefined, {
      name: "UNPROCESSABLE_ENTITY",
      message: `Capture of ${fromCents(amountCents)} ${currency} exceeds the authorized ${fromCents(authorizedCents)} ${currency}`,
      description: PAYPAL_ISSUE_MESSAGES.MAX_CAPTURE_AMOUNT_EXCEEDED,
    });
  }
}

/**
 * Capture an authorization. `final_capture` is always `true` (MANUAL §10.3):
 * ProofPay makes exactly one capture per authorization, full or partial.
 */
export async function captureAuthorization(
  authorizationId: string,
  options: CaptureOptions,
): Promise<Capture> {
  const currency = options.currency ?? getEnv().CURRENCY;
  checkAmount(options.amountCents, options.authorizedCents, currency);

  const body = {
    ...(options.amountCents !== undefined
      ? { amount: amountBody(options.amountCents, currency) }
      : {}),
    final_capture: true,
    invoice_id: options.invoiceId,
    ...(options.noteToPayer ? { note_to_payer: options.noteToPayer } : {}),
  };

  const { data } = await withPaypalIdempotency(
    { jobId: options.jobId, op: "capture", attempt: options.attempt, db: options.db },
    (requestId) =>
      ppFetch<Capture>(
        `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
        { method: "POST", body, idempotencyKey: requestId, schema: CaptureSchema },
      ),
  );
  return data;
}

/** Void an authorization (no money captured). PayPal returns 204. */
export async function voidAuthorization(
  authorizationId: string,
  context: PaymentsContext,
): Promise<void> {
  await withPaypalIdempotency(
    { jobId: context.jobId, op: "void", attempt: context.attempt, db: context.db },
    async (requestId) => {
      await ppFetch(
        `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
        { method: "POST", body: {}, idempotencyKey: requestId, prefer: "return=representation" },
      );
      return { voided: true };
    },
  );
}

/** Reauthorize after the honor period; replaces the authorization id. */
export async function reauthorize(
  authorizationId: string,
  options: PaymentsContext & { amountCents?: number; currency?: string },
): Promise<Authorization> {
  const currency = options.currency ?? getEnv().CURRENCY;
  const body =
    options.amountCents !== undefined
      ? { amount: amountBody(options.amountCents, currency) }
      : {};
  const { data } = await withPaypalIdempotency(
    { jobId: options.jobId, op: "reauthorize", attempt: options.attempt, db: options.db },
    (requestId) =>
      ppFetch<Authorization>(
        `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/reauthorize`,
        { method: "POST", body, idempotencyKey: requestId, schema: AuthorizationSchema },
      ),
  );
  return data;
}

/** Refund a capture, full (no amount) or partial. */
export async function refundCapture(
  captureId: string,
  options: PaymentsContext & {
    amountCents?: number;
    currency?: string;
    noteToPayer?: string;
  },
): Promise<Refund> {
  const currency = options.currency ?? getEnv().CURRENCY;
  const body = {
    ...(options.amountCents !== undefined
      ? { amount: amountBody(options.amountCents, currency) }
      : {}),
    ...(options.noteToPayer ? { note_to_payer: options.noteToPayer } : {}),
  };
  const { data } = await withPaypalIdempotency(
    { jobId: options.jobId, op: "refund", attempt: options.attempt, db: options.db },
    (requestId) =>
      ppFetch<Refund>(
        `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
        { method: "POST", body, idempotencyKey: requestId, schema: RefundSchema },
      ),
  );
  return data;
}

/** Read the current authorization state (used to check expiry and captures). */
export async function getAuthorization(
  authorizationId: string,
): Promise<Authorization> {
  return ppFetch<Authorization>(
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`,
    { schema: AuthorizationSchema },
  );
}

/** Convenience re-export so callers do not need the errors module. */
export { PayPalError, friendlyPayPalMessage } from "./errors";
