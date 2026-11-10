import "server-only";
import { createHash } from "node:crypto";
import { generateText, stepCountIs, type LanguageModel } from "ai";
import type { EventItem, Job, SettlementProposal, VerificationBundle } from "@/shared/contracts";
import { fromCents, toCents } from "@/shared/money";
import { getLanguageModel } from "@/server/ai";
import { getDb, type ProofPayDb } from "@/server/db/client";
import { getJob, insertEvent } from "@/server/db/repo";
import { getEnv } from "@/server/env";
import { transition } from "@/server/escrow/machine";
import { SETTLEMENT_SYSTEM_PROMPT } from "./prompts";
import { agentBriefing, buildAgentTools, createAgentContext, type AgentRunContext } from "./tools";

/**
 * Settlement agent (docs/MANUAL.md §11). After a PARTIAL, REJECTED or
 * HUMAN_REVIEW decision it writes an `AGENT_MESSAGE` event: a plain-language
 * explanation and, for PARTIAL, a `SettlementProposal`. It never moves money;
 * the customer's accept click or a reviewer decision does, behind `policy.ts`.
 *
 * `VISION_MOCK=1` (or any AI failure) uses a deterministic template.
 */

export const AGENT_MODEL_TEMPLATE = "template";
export const AGENT_MAX_STEPS = 6;
export const AGENT_TIMEOUT_MS = 30_000;
const MAX_WORDS = 80;

export type SettlementAgentDeps = {
  /** Test seam: a model to call instead of the configured `LLM_MODEL`. */
  model?: LanguageModel;
  /** Force the template (default: `VISION_MOCK`). */
  mock?: boolean;
};

function limitWords(text: string): string {
  const words = text.trim().split(/\s+/);
  return words.length <= MAX_WORDS ? words.join(" ") : `${words.slice(0, MAX_WORDS).join(" ")}…`;
}

const amountText = (cents: number, currency: string) => `${fromCents(cents)} ${currency}`;

/** Deterministic explanation that cites criterion ids and forensics flag codes. */
export function templateExplanation(job: Job, verification: VerificationBundle): string {
  const { decision, report, forensics } = verification;
  const scored = job.criteria.filter((criterion) => criterion.weight > 0);
  const verdictOf = (id: string) => report.verdicts.find((v) => v.criterionId === id)?.verdict ?? "NOT_VISIBLE";
  const passed = scored.filter((criterion) => verdictOf(criterion.id) === "PASS").length;
  const open = job.criteria
    .filter((criterion) => verdictOf(criterion.id) !== "PASS")
    .map((criterion) => `${criterion.id} (${verdictOf(criterion.id)})`);
  const flags = forensics.flags.filter((flag) => flag.level !== "INFO").map((flag) => flag.code);
  const checked = `${passed} of ${scored.length} checklist items were verified by AI.`;
  const notVerified = open.length ? ` Not verified: ${open.join(", ")}.` : "";
  const flagText = flags.length ? ` Flags: ${flags.join(", ")}.` : "";
  const currency = job.amount.currency;
  const totalCents = toCents(job.amount.value);

  if (decision.outcome === "PARTIAL" && decision.captureAmount) {
    const captureCents = toCents(decision.captureAmount.value);
    const percent = Math.round((captureCents / totalCents) * 100);
    return limitWords(
      `${checked}${notVerified}${flagText} Proposed: capture ${amountText(captureCents, currency)} (${percent}%) now and release the remaining ${amountText(totalCents - captureCents, currency)} PayPal hold.`,
    );
  }
  if (decision.outcome === "HUMAN_REVIEW") {
    return limitWords(
      `${checked}${notVerified}${flagText} A human reviewer will decide before any money moves; the ${amountText(totalCents, currency)} stays held by PayPal.`,
    );
  }
  if (decision.outcome === "REJECTED") {
    return limitWords(
      `${checked}${notVerified}${flagText} The evidence does not meet the checklist, so nothing is captured. The worker can resubmit once; otherwise the PayPal hold is released.`,
    );
  }
  return limitWords(`${checked} The full ${amountText(totalCents, currency)} can be captured.`);
}

/** Stable per verification, so re-running the agent gives the same proposal. */
function proposalIdFor(verificationId: string): string {
  return `prp_${createHash("sha256").update(verificationId).digest("hex").slice(0, 12)}`;
}

async function askModel(ctx: AgentRunContext, model: LanguageModel): Promise<string | undefined> {
  const result = await generateText({
    model,
    system: SETTLEMENT_SYSTEM_PROMPT,
    prompt: [
      "An AI inspection of a paid job just finished. Facts (JSON):",
      agentBriefing(ctx),
      ctx.verification.decision.outcome === "PARTIAL"
        ? "Call propose_settlement once with a fair amount (never above decision.captureAmount) and an explanation citing criterion ids."
        : "Explain the outcome to both parties, citing criterion ids and flag codes. Call escalate_to_human if a reviewer is needed.",
      "Then reply with the final message for the customer and the worker (under 80 words).",
    ].join("\n"),
    tools: buildAgentTools(ctx),
    stopWhen: stepCountIs(AGENT_MAX_STEPS),
    temperature: 0.2,
    abortSignal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
  });
  return ctx.proposal?.explanation ?? (result.text.trim() || undefined);
}

/**
 * Write the agent's `AGENT_MESSAGE` event for the job's latest verification.
 * Returns `null` when there is no verification to explain.
 */
export async function runSettlementAgent(
  jobId: string,
  db: ProofPayDb = getDb(),
  deps: SettlementAgentDeps = {},
): Promise<EventItem | null> {
  const job = getJob(jobId, db);
  const verification = job?.latestVerification;
  if (!job || !verification) return null;

  const { decision } = verification;
  const ctx = createAgentContext(job, verification, db);
  const mock = deps.mock ?? getEnv().VISION_MOCK;
  let explanation = templateExplanation(job, verification);
  let model = AGENT_MODEL_TEMPLATE;

  if (!mock) {
    try {
      const languageModel = deps.model ?? getLanguageModel();
      const written = await askModel(ctx, languageModel);
      if (written) {
        explanation = limitWords(written);
        model = typeof languageModel === "string" ? languageModel : languageModel.modelId;
      }
    } catch (error) {
      console.warn(
        `[agent] model call failed for ${jobId}; using the template (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  const base = { explanation, outcome: decision.outcome, model, mock: model === AGENT_MODEL_TEMPLATE };

  if (decision.outcome === "PARTIAL" && decision.captureAmount && !ctx.escalation) {
    const totalCents = toCents(job.amount.value);
    // Never above the decision; the model may only propose the same or less.
    const captureCents =
      ctx.proposal && ctx.proposal.captureCents > 0 ? ctx.proposal.captureCents : ctx.capCents;
    const proposal: SettlementProposal = {
      proposalId: proposalIdFor(verification.id),
      kind: "PARTIAL_CAPTURE",
      captureAmount: { currency: job.amount.currency, value: fromCents(captureCents) },
      releaseAmount: { currency: job.amount.currency, value: fromCents(Math.max(0, totalCents - captureCents)) },
      explanation,
      basedOnVerificationId: verification.id,
    };
    return insertEvent(
      {
        jobId,
        type: "AGENT_MESSAGE",
        actor: "agent",
        // The proposal fields sit at the top level (MANUAL §8) and under `proposal`.
        data: {
          ...proposal,
          proposal,
          ...base,
          ...(ctx.proposal?.clampedFromCents !== undefined
            ? { clampedFrom: fromCents(ctx.proposal.clampedFromCents) }
            : {}),
        },
      },
      db,
    );
  }

  const event = insertEvent(
    {
      jobId,
      type: "AGENT_MESSAGE",
      actor: "agent",
      data: { kind: "EXPLANATION", ...base, ...(ctx.escalation ? { escalation: ctx.escalation.reason } : {}) },
    },
    db,
  );
  if (ctx.escalation && job.status === "PARTIAL") {
    transition(jobId, "HUMAN_REVIEW", "agent", { reason: ctx.escalation.reason }, db);
  }
  return event;
}
