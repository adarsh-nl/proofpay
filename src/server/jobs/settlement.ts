import "server-only";
import {
  SettlementProposalSchema,
  type Job,
  type Money,
  type ReviewBody,
  type SettlementProposal,
} from "@/shared/contracts";
import { toCents } from "@/shared/money";
import { getDb, type ProofPayDb } from "@/server/db/client";
import { assertCanRefund } from "@/server/agent/policy";
import { insertEvent } from "@/server/db/repo";
import { IllegalTransition, transition, type Actor } from "@/server/escrow/machine";
import { settle } from "@/server/escrow/settle";
import { ConflictError, ValidationError } from "@/server/http/errors";
import { requireJob } from "./jobs";

/**
 * Human decisions that move money (docs/MANUAL.md §8 #11–15, prompt C8).
 * Each one records its approval event first; `settle()` then makes the PayPal
 * call and only changes the status after PayPal accepted it.
 */

function centsOf(amount: Money, job: Job, what: string): number {
  if (amount.currency !== job.amount.currency) {
    throw new ValidationError(`${what} must be in ${job.amount.currency}.`, "CURRENCY_MISMATCH");
  }
  return toCents(amount.value);
}

/** Latest settlement proposal written by the agent (an `AGENT_MESSAGE` event). */
export function findLatestProposal(job: Job): SettlementProposal | undefined {
  for (let index = job.events.length - 1; index >= 0; index -= 1) {
    const event = job.events[index];
    if (event?.type !== "AGENT_MESSAGE") continue;
    const data: unknown = event.data;
    const nested = typeof data === "object" && data !== null ? (data as { proposal?: unknown }).proposal : undefined;
    for (const candidate of [data, nested]) {
      const parsed = SettlementProposalSchema.safeParse(candidate);
      if (parsed.success) return parsed.data;
    }
  }
  return undefined;
}

function requireProposal(job: Job, proposalId: string): SettlementProposal {
  if (job.status !== "PARTIAL") {
    throw new ConflictError(
      `There is no open settlement proposal while the job is ${job.status}.`,
      "NO_OPEN_PROPOSAL",
    );
  }
  const proposal = findLatestProposal(job);
  if (!proposal || proposal.proposalId !== proposalId) {
    throw new ConflictError(
      "This settlement proposal is no longer current. Reload the job.",
      "PROPOSAL_NOT_CURRENT",
    );
  }
  return proposal;
}

/** #11: the customer accepts the proposal → partial capture → CAPTURED. */
export async function acceptProposal(
  jobId: string,
  proposalId: string,
  db: ProofPayDb = getDb(),
): Promise<Job> {
  const job = requireJob(jobId, db);
  const proposal = requireProposal(job, proposalId);
  const amountCents = centsOf(proposal.captureAmount, job, "The proposal amount");
  insertEvent(
    {
      jobId,
      type: "SETTLEMENT_ACCEPTED",
      actor: "customer",
      data: { proposalId, captureAmount: proposal.captureAmount },
    },
    db,
  );
  return (await settle(jobId, { kind: "PARTIAL", amountCents, actor: "customer" }, db)).job;
}

/** #12: the customer or worker declines → HUMAN_REVIEW. */
export function declineProposal(
  jobId: string,
  proposalId: string,
  reason: string,
  actor: Extract<Actor, "customer" | "worker">,
  db: ProofPayDb = getDb(),
): Job {
  const job = requireJob(jobId, db);
  requireProposal(job, proposalId);
  insertEvent(
    { jobId, type: "SETTLEMENT_DECLINED", actor, data: { proposalId, reason } },
    db,
  );
  return transition(jobId, "HUMAN_REVIEW", actor, { reason, proposalId, declinedBy: actor }, db);
}

/**
 * #13: reviewer decision on a HUMAN_REVIEW job (C8).
 * APPROVE → APPROVED → full capture; PARTIAL(amount) → PARTIAL → partial
 * capture; REJECT → REJECTED → void, all in the same request.
 */
export async function reviewJob(
  jobId: string,
  body: ReviewBody,
  db: ProofPayDb = getDb(),
): Promise<Job> {
  const job = requireJob(jobId, db);
  const target =
    body.decision === "APPROVE" ? "APPROVED" : body.decision === "PARTIAL" ? "PARTIAL" : "REJECTED";
  if (job.status !== "HUMAN_REVIEW") throw new IllegalTransition(job.status, target);

  let amountCents: number | undefined;
  if (body.decision === "PARTIAL") {
    if (!body.amount) throw new ValidationError("A partial decision needs an amount.", "AMOUNT_REQUIRED");
    amountCents = centsOf(body.amount, job, "The amount");
    const authorizedCents = job.payment?.authorized ? toCents(job.payment.authorized.value) : 0;
    if (amountCents <= 0 || amountCents > authorizedCents) {
      throw new ValidationError(
        `The amount must be more than 0 and at most the ${job.payment?.authorized?.value ?? "0.00"} ${job.amount.currency} held by PayPal.`,
        "AMOUNT_OUT_OF_RANGE",
      );
    }
  }

  insertEvent(
    {
      jobId,
      type: "REVIEW",
      actor: "reviewer",
      data: { decision: body.decision, amount: body.amount ?? null, notes: body.notes },
    },
    db,
  );
  transition(jobId, target, "reviewer", { decision: body.decision, notes: body.notes }, db);

  if (body.decision === "APPROVE") {
    return (await settle(jobId, { kind: "FULL", actor: "reviewer" }, db)).job;
  }
  if (body.decision === "PARTIAL" && amountCents !== undefined) {
    return (await settle(jobId, { kind: "PARTIAL", amountCents, actor: "reviewer" }, db)).job;
  }
  return (await settle(jobId, { kind: "VOID", actor: "reviewer" }, db)).job;
}

/** #14: release the hold. Allowed from AUTHORIZED and REJECTED. */
export async function voidJob(
  jobId: string,
  reason: string,
  actor: Extract<Actor, "customer" | "reviewer">,
  db: ProofPayDb = getDb(),
): Promise<Job> {
  const job = requireJob(jobId, db);
  if (job.status !== "AUTHORIZED" && job.status !== "REJECTED") {
    throw new IllegalTransition(job.status, "VOIDED");
  }
  insertEvent({ jobId, type: "VOID_REQUESTED", actor, data: { reason } }, db);
  return (await settle(jobId, { kind: "VOID", actor }, db)).job;
}

/** #15: reviewer-initiated refund of a captured payment (full when no amount). */
export async function refundJob(
  jobId: string,
  amount: Money | undefined,
  reason: string,
  db: ProofPayDb = getDb(),
): Promise<Job> {
  const job = requireJob(jobId, db);
  if (job.status !== "CAPTURED") throw new IllegalTransition(job.status, "REFUNDED");
  const amountCents = amount ? centsOf(amount, job, "The refund amount") : undefined;
  insertEvent(
    {
      jobId,
      type: "REVIEW",
      actor: "reviewer",
      data: { decision: "REFUND", amount: amount ?? null, notes: reason },
    },
    db,
  );
  assertCanRefund(jobId, db);
  return (await settle(jobId, { kind: "REFUND", amountCents, actor: "reviewer" }, db)).job;
}
