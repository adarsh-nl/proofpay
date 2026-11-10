import "server-only";

import type { Job } from "@/shared/contracts";
import { toCents } from "@/shared/money";
import { getDb, type ProofPayDb } from "@/server/db/client";
import {
  getJob,
  getPayment,
  hasEvent,
  insertEvent,
  upsertPayment,
} from "@/server/db/repo";
import { getEnv } from "@/server/env";
import { ConflictError, NotFoundError, PolicyError } from "@/server/http/errors";
import { PayPalError, PayPalNetworkError } from "@/server/paypal/errors";
import {
  captureAuthorization,
  refundCapture,
  voidAuthorization,
} from "@/server/paypal/payments";
import { assertCanCapture } from "@/server/agent/policy";
import { IllegalTransition, transition, type Actor } from "./machine";

/**
 * PayPal side effects for the escrow state machine (docs/MANUAL.md §7).
 *
 * Rules:
 * - The PayPal call happens **first**; the status only changes after PayPal
 *   accepted it. On a PayPal error the status stays put and a `PAYPAL_CALL`
 *   event with the error is logged (MANUAL §7).
 * - PARTIAL capture requires a recorded human approval: a customer
 *   `SETTLEMENT_ACCEPTED` event or a reviewer `REVIEW` event. No code path may
 *   capture part of the money otherwise.
 * - Every capture is `final_capture: true` (one capture per authorization).
 */

export type SettleAction =
  | { kind: "FULL"; actor?: Actor }
  | { kind: "PARTIAL"; amountCents: number; actor?: Actor }
  | { kind: "VOID"; actor?: Actor }
  | { kind: "REFUND"; amountCents?: number; actor?: Actor };

export interface SettleResult {
  job: Job;
  capturedCents: number;
  captureId?: string;
  refundedCents: number;
}

function logPayPalCall(
  jobId: string,
  op: string,
  error: unknown,
  db: ProofPayDb,
): void {
  const isPayPal = error instanceof PayPalError;
  insertEvent(
    {
      jobId,
      type: "PAYPAL_CALL",
      actor: "system",
      data: {
        op,
        ok: false,
        issue: isPayPal ? error.issue : "PAYPAL_UNREACHABLE",
        status: isPayPal ? error.status : undefined,
        debugId: isPayPal ? error.debugId : undefined,
        message: error instanceof Error ? error.message : String(error),
        network: error instanceof PayPalNetworkError,
      },
    },
    db,
  );
}

interface PaymentContext {
  authorizationId: string;
  authorizedCents: number;
  captureIds: string[];
  capturedCents: number;
  refundedCents: number;
  currency: string;
}

function requirePayment(job: Job, db: ProofPayDb): PaymentContext {
  const payment = getPayment(job.id, db);
  if (!payment?.authorizationId) {
    throw new ConflictError(
      "This job has no PayPal authorization to settle",
      "NO_AUTHORIZATION",
    );
  }
  return {
    authorizationId: payment.authorizationId,
    authorizedCents: payment.authorized
      ? toCents(payment.authorized.value)
      : job.amount.value
        ? toCents(job.amount.value)
        : 0,
    captureIds: payment.captureIds,
    capturedCents: toCents(payment.captured.value),
    refundedCents: toCents(payment.refunded.value),
    currency: job.amount.currency,
  };
}

function assertCaptureFrom(job: Job, expected: Job["status"][]): void {
  if (!expected.includes(job.status)) {
    throw new IllegalTransition(job.status, "CAPTURED");
  }
}

async function capture(
  job: Job,
  payment: PaymentContext,
  amountCents: number | undefined,
  actor: Actor,
  db: ProofPayDb,
): Promise<SettleResult> {
  // Policy gate: no capture without the required approval (src/server/agent/policy.ts).
  assertCanCapture(job.id, amountCents ?? payment.authorizedCents, db);
  const invoiceId = `${job.id}-${payment.captureIds.length + 1}`;
  let captureId: string;
  let capturedCents: number;
  try {
    const result = await captureAuthorization(payment.authorizationId, {
      jobId: job.id,
      amountCents,
      authorizedCents: payment.authorizedCents,
      currency: payment.currency,
      invoiceId,
      noteToPayer: "Verified by ProofPay",
      attempt: payment.captureIds.length + 1,
      db,
    });
    captureId = result.id;
    capturedCents = result.amount
      ? toCents(result.amount.value)
      : (amountCents ?? payment.authorizedCents);
  } catch (error) {
    logPayPalCall(job.id, "capture", error, db);
    throw error;
  }

  upsertPayment(
    job.id,
    {
      capturedCents: payment.capturedCents + capturedCents,
      captureIds: [...payment.captureIds, captureId],
    },
    db,
  );
  const updated = transition(
    job.id,
    "CAPTURED",
    actor,
    { kind: amountCents === undefined ? "FULL" : "PARTIAL", captureId, capturedCents },
    db,
  );
  return {
    job: updated,
    capturedCents: payment.capturedCents + capturedCents,
    captureId,
    refundedCents: payment.refundedCents,
  };
}

/** Execute a settlement action; PayPal first, then the state transition. */
export async function settle(
  jobId: string,
  action: SettleAction,
  db: ProofPayDb = getDb(),
): Promise<SettleResult> {
  const job = getJob(jobId, db);
  if (!job) throw new NotFoundError("Job");
  const payment = requirePayment(job, db);

  switch (action.kind) {
    case "FULL": {
      assertCaptureFrom(job, ["APPROVED"]);
      return capture(job, payment, undefined, action.actor ?? "system", db);
    }
    case "PARTIAL": {
      if (job.status !== "PARTIAL") {
        throw new IllegalTransition(job.status, "CAPTURED");
      }
      if (!hasEvent(jobId, ["SETTLEMENT_ACCEPTED", "REVIEW"], db)) {
        throw new PolicyError(
          "A partial capture needs a recorded approval: the customer accepting the proposal or a reviewer decision.",
          "APPROVAL_REQUIRED",
        );
      }
      if (!Number.isInteger(action.amountCents) || action.amountCents <= 0) {
        throw new PolicyError(
          "The partial capture amount must be a positive amount in cents",
          "INVALID_AMOUNT",
        );
      }
      if (action.amountCents > payment.authorizedCents) {
        throw new PolicyError(
          `The partial capture (${action.amountCents}) exceeds the authorized amount (${payment.authorizedCents})`,
          "AMOUNT_EXCEEDS_AUTHORIZATION",
        );
      }
      const approvedByCustomer = hasEvent(jobId, ["SETTLEMENT_ACCEPTED"], db);
      return capture(
        job,
        payment,
        action.amountCents,
        action.actor ?? (approvedByCustomer ? "customer" : "reviewer"),
        db,
      );
    }
    case "VOID": {
      if (job.status !== "AUTHORIZED" && job.status !== "REJECTED") {
        throw new IllegalTransition(job.status, "VOIDED");
      }
      try {
        await voidAuthorization(payment.authorizationId, {
          jobId,
          attempt: payment.captureIds.length + 1,
          db,
        });
      } catch (error) {
        logPayPalCall(jobId, "void", error, db);
        throw error;
      }
      upsertPayment(jobId, { voidedAt: new Date().toISOString() }, db);
      const updated = transition(
        jobId,
        "VOIDED",
        action.actor ?? "customer",
        { kind: "VOID", authorizationId: payment.authorizationId },
        db,
      );
      return {
        job: updated,
        capturedCents: payment.capturedCents,
        refundedCents: payment.refundedCents,
      };
    }
    case "REFUND": {
      if (job.status !== "CAPTURED") {
        throw new IllegalTransition(job.status, "REFUNDED");
      }
      const captureId = payment.captureIds.at(-1);
      if (!captureId) {
        throw new ConflictError(
          "This job has no captured PayPal payment to refund",
          "NO_CAPTURE",
        );
      }
      const refundable = payment.capturedCents - payment.refundedCents;
      const amountCents = action.amountCents ?? refundable;
      if (amountCents <= 0 || amountCents > refundable) {
        throw new PolicyError(
          `Refund of ${amountCents} cents is not possible; ${refundable} cents remain refundable`,
          "INVALID_REFUND_AMOUNT",
        );
      }
      try {
        await refundCapture(captureId, {
          jobId,
          amountCents,
          currency: payment.currency,
          noteToPayer: "ProofPay refund",
          attempt: payment.refundedCents + amountCents,
          db,
        });
      } catch (error) {
        logPayPalCall(jobId, "refund", error, db);
        throw error;
      }
      const refundedCents = payment.refundedCents + amountCents;
      upsertPayment(jobId, { refundedCents }, db);
      const updated = transition(
        jobId,
        "REFUNDED",
        action.actor ?? "reviewer",
        { kind: "REFUND", captureId, amountCents, refundedCents },
        db,
      );
      return {
        job: updated,
        capturedCents: payment.capturedCents,
        captureId,
        refundedCents,
      };
    }
    default: {
      const exhaustive: never = action;
      throw new Error(`[settle] unknown action ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Called when a verification ends `APPROVED`: auto-captures the full amount
 * unless `AUTO_CAPTURE_ON_APPROVE=0` (then the customer/reviewer captures it).
 */
export async function onApproved(
  jobId: string,
  db: ProofPayDb = getDb(),
): Promise<Job> {
  const job = getJob(jobId, db);
  if (!job) throw new NotFoundError("Job");
  if (job.status !== "APPROVED") return job;
  if (!getEnv().AUTO_CAPTURE_ON_APPROVE) {
    console.info(`[settle] AUTO_CAPTURE_ON_APPROVE=0; leaving ${jobId} APPROVED`);
    return job;
  }
  const result = await settle(jobId, { kind: "FULL" }, db);
  return result.job;
}
