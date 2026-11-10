import "server-only";
import type { Job } from "@/shared/contracts";
import { toCents } from "@/shared/money";
import { getDb, type ProofPayDb } from "@/server/db/client";
import { getJob } from "@/server/db/repo";
import { NotFoundError, PolicyError } from "@/server/http/errors";

/**
 * Money guardrails, enforced in code and not in a prompt (docs/MANUAL.md §11,
 * AGENTS.md §12). Every capture goes through `assertCanCapture`:
 *
 * - a reviewer `REVIEW` decision (APPROVE or PARTIAL) allows up to the authorized amount;
 * - a customer `SETTLEMENT_ACCEPTED` allows up to `decision.captureAmount`;
 * - with neither, only the automatic full capture of a job whose verification
 *   ended `APPROVED` is allowed (MANUAL §7), never a partial one.
 */

export type CaptureApproval = "reviewer" | "customer" | "auto-approved";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasReviewerCaptureDecision(job: Job): boolean {
  return job.events.some(
    (event) =>
      event.type === "REVIEW" &&
      event.actor === "reviewer" &&
      isRecord(event.data) &&
      (event.data.decision === "APPROVE" || event.data.decision === "PARTIAL"),
  );
}

function hasCustomerAcceptance(job: Job): boolean {
  return job.events.some(
    (event) => event.type === "SETTLEMENT_ACCEPTED" && event.actor === "customer",
  );
}

function authorizedCentsOf(job: Job): number {
  return job.payment?.authorized ? toCents(job.payment.authorized.value) : 0;
}

/** Throws `PolicyError` (403) unless capturing `amountCents` is allowed right now. */
export function assertCanCapture(
  jobId: string,
  amountCents: number,
  db: ProofPayDb = getDb(),
): CaptureApproval {
  const job = getJob(jobId, db);
  if (!job) throw new NotFoundError("Job");
  const authorizedCents = authorizedCentsOf(job);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new PolicyError("The capture amount must be a positive amount in cents.", "INVALID_AMOUNT");
  }
  if (amountCents > authorizedCents) {
    throw new PolicyError(
      "The capture would exceed the amount held by PayPal.",
      "AMOUNT_EXCEEDS_AUTHORIZATION",
      { amountCents, authorizedCents },
    );
  }

  if (hasReviewerCaptureDecision(job)) return "reviewer";

  const decision = job.latestVerification?.decision;
  const decisionCents = decision?.captureAmount ? toCents(decision.captureAmount.value) : undefined;

  if (hasCustomerAcceptance(job)) {
    if (job.latestVerification && decisionCents === undefined) {
      throw new PolicyError(
        "The verification decision has no capture amount, so a reviewer must decide.",
        "NO_DECISION_AMOUNT",
      );
    }
    if (decisionCents !== undefined && amountCents > decisionCents) {
      throw new PolicyError(
        "The capture would exceed the amount the verification decision allows.",
        "AMOUNT_EXCEEDS_DECISION",
        { amountCents, decisionCents },
      );
    }
    return "customer";
  }

  const autoApproved =
    job.status === "APPROVED" &&
    (!decision || decision.outcome === "APPROVED") &&
    amountCents === authorizedCents;
  if (autoApproved) return "auto-approved";

  throw new PolicyError(
    "Money can only be captured after a recorded approval: the customer accepting the proposal or a reviewer decision.",
    "APPROVAL_REQUIRED",
  );
}

/** Throws `PolicyError` (403) unless a reviewer has recorded a refund decision. */
export function assertCanRefund(jobId: string, db: ProofPayDb = getDb()): void {
  const job = getJob(jobId, db);
  if (!job) throw new NotFoundError("Job");
  const approved = job.events.some(
    (event) =>
      event.type === "REVIEW" &&
      event.actor === "reviewer" &&
      isRecord(event.data) &&
      event.data.decision === "REFUND",
  );
  if (!approved) {
    throw new PolicyError(
      "A refund needs a recorded reviewer decision.",
      "REVIEWER_APPROVAL_REQUIRED",
    );
  }
}
