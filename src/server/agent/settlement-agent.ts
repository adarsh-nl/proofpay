import "server-only";

import { randomUUID } from "node:crypto";
import type { EventItem, SettlementProposal } from "@/shared/contracts";
import { fromCents, toCents } from "@/shared/money";
import { getDb, type ProofPayDb } from "@/server/db/client";
import { getJob, insertEvent } from "@/server/db/repo";

/**
 * Settlement agent — TEMPLATE IMPLEMENTATION created by T13 so the
 * orchestrator can emit a proposal for PARTIAL / HUMAN_REVIEW outcomes.
 * T14 replaces this file with the real AI SDK agent (tools + policy gate).
 *
 * The templated proposal is deterministic: it cites the criterion ids from
 * `decision.reasons` and never moves money by itself (only the customer
 * accepting it, or a reviewer decision, leads to a capture).
 */

export const AGENT_MODEL_TEMPLATE = "template";

function buildExplanation(
  outcome: string,
  reasons: string[],
  capturedPercent?: number,
): string {
  const cited = reasons.slice(0, 3).join("; ");
  if (outcome === "PARTIAL" && capturedPercent !== undefined) {
    return `Verification scored ${capturedPercent}% of the checklist. ${cited}. Proposed: capture the verified share now and release the rest.`;
  }
  const prefix =
    outcome === "HUMAN_REVIEW"
      ? "This job needs a human review before any money moves."
      : `Verification outcome: ${outcome}.`;
  return `${prefix} ${cited}`.trim();
}

/**
 * Write the agent's `AGENT_MESSAGE` event for the job's latest verification.
 * Returns `null` when there is no verification to explain.
 */
export async function runSettlementAgent(
  jobId: string,
  db: ProofPayDb = getDb(),
): Promise<EventItem | null> {
  const job = getJob(jobId, db);
  const verification = job?.latestVerification;
  if (!job || !verification) return null;

  const decision = verification.decision;
  const totalCents = toCents(job.amount.value);
  let proposal: SettlementProposal | undefined;
  let capturedPercent: number | undefined;

  if (decision.outcome === "PARTIAL" && decision.captureAmount) {
    const captureCents = toCents(decision.captureAmount.value);
    capturedPercent = Math.round((captureCents / totalCents) * 100);
    proposal = {
      proposalId: `prp_${randomUUID().slice(0, 12)}`,
      kind: "PARTIAL_CAPTURE",
      captureAmount: decision.captureAmount,
      releaseAmount: {
        currency: job.amount.currency,
        value: fromCents(Math.max(0, totalCents - captureCents)),
      },
      explanation: buildExplanation(
        decision.outcome,
        decision.reasons,
        capturedPercent,
      ),
      basedOnVerificationId: verification.id,
    };
  }

  const explanation =
    proposal?.explanation ??
    buildExplanation(decision.outcome, decision.reasons);

  console.info(
    `[settlement-agent] templated ${decision.outcome} explanation for ${jobId} (verification ${verification.id})`,
  );

  return insertEvent(
    {
      jobId,
      type: "AGENT_MESSAGE",
      actor: "agent",
      data: proposal
        ? { proposal, explanation, model: AGENT_MODEL_TEMPLATE }
        : {
            explanation,
            outcome: decision.outcome,
            model: AGENT_MODEL_TEMPLATE,
          },
    },
    db,
  );
}
