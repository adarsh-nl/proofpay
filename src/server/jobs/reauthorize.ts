import "server-only";
import type { Job } from "@/shared/contracts";
import { toCents } from "@/shared/money";
import { getDb, type ProofPayDb } from "@/server/db/client";
import { insertEvent, upsertPayment } from "@/server/db/repo";
import { ConflictError } from "@/server/http/errors";
import { PayPalError, friendlyPayPalMessage } from "@/server/paypal/errors";
import { HONOR_PERIOD_MS } from "@/server/paypal/orders";
import { reauthorize } from "@/server/paypal/payments";
import { requireJob } from "./jobs";

/**
 * Reauthorize a hold (MANUAL §8 #16, stretch S4): PayPal issues a new
 * authorization, which replaces the stored id and restarts the 3-day honor
 * period. The escrow status does not change. PayPal refuses this while the
 * honor period is still running; that comes back as a 409 with a plain message.
 */

/** Statuses in which the hold is still open and nothing has been captured. */
const REAUTHORIZABLE = ["AUTHORIZED", "EVIDENCE_SUBMITTED", "APPROVED", "PARTIAL", "REJECTED", "HUMAN_REVIEW"] as const;

export async function reauthorizeJob(jobId: string, db: ProofPayDb = getDb()): Promise<Job> {
  const job = requireJob(jobId, db);
  const payment = job.payment;
  if (!(REAUTHORIZABLE as readonly string[]).includes(job.status) || !payment?.authorizationId) {
    throw new ConflictError(
      `There is no open PayPal hold to reauthorize while the job is ${job.status}.`,
      "NOT_REAUTHORIZABLE",
    );
  }
  const previous = job.events.filter(
    (event) =>
      event.type === "PAYPAL_CALL" &&
      typeof event.data === "object" &&
      event.data !== null &&
      (event.data as { op?: unknown; ok?: unknown }).op === "reauthorize" &&
      (event.data as { ok?: unknown }).ok === true,
  ).length;

  let next;
  try {
    next = await reauthorize(payment.authorizationId, {
      jobId,
      attempt: previous + 1,
      currency: job.amount.currency,
      db,
    });
  } catch (error) {
    const isPayPal = error instanceof PayPalError;
    insertEvent(
      {
        jobId,
        type: "PAYPAL_CALL",
        actor: "reviewer",
        data: {
          op: "reauthorize",
          ok: false,
          issue: isPayPal ? error.issue : "PAYPAL_UNREACHABLE",
          debugId: isPayPal ? error.debugId : undefined,
        },
      },
      db,
    );
    // A 4xx from PayPal is about the state of the hold, not an outage.
    if (isPayPal && error.status >= 400 && error.status < 500 && error.status !== 401) {
      throw new ConflictError(
        friendlyPayPalMessage(error, "PayPal did not reauthorize this hold. It may still be inside its 3-day honor period."),
        error.issue,
        { debugId: error.debugId },
      );
    }
    throw error;
  }

  const now = Date.now();
  upsertPayment(
    jobId,
    {
      authorizationId: next.id,
      authorizationStatus: next.status,
      ...(next.amount ? { authorizedCents: toCents(next.amount.value) } : {}),
      ...(next.expiration_time ? { authorizationExpiresAt: next.expiration_time } : {}),
      honorPeriodEndsAt: new Date(now + HONOR_PERIOD_MS).toISOString(),
    },
    db,
  );
  insertEvent(
    {
      jobId,
      type: "PAYPAL_CALL",
      actor: "reviewer",
      data: {
        op: "reauthorize",
        ok: true,
        previousAuthorizationId: payment.authorizationId,
        authorizationId: next.id,
        status: next.status,
      },
    },
    db,
  );
  return requireJob(jobId, db);
}
