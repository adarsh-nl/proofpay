import "server-only";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { Job, VerificationBundle } from "@/shared/contracts";
import { fromCents, toCents } from "@/shared/money";
import type { ProofPayDb } from "@/server/db/client";
import { insertEvent } from "@/server/db/repo";
import { getEnv } from "@/server/env";
import { buildEvidencePack } from "./evidence-pack";
import { callToolkit } from "./paypal-toolkit";

/**
 * Tools of the settlement agent (docs/MANUAL.md §11). None of them moves
 * money: a proposal is only recorded, and capture/void/refund stay behind the
 * human approval checked in `policy.ts`.
 */

export type AgentProposal = {
  kind: "FULL" | "PARTIAL" | "VOID";
  captureCents: number;
  explanation: string;
  /** Set when the model asked for more than the decision allows. */
  clampedFromCents?: number;
};

export type AgentRunContext = {
  db: ProofPayDb;
  job: Job;
  verification: VerificationBundle;
  /** Upper bound for any proposal: `decision.captureAmount` (0 when absent). */
  capCents: number;
  proposal?: AgentProposal;
  escalation?: { reason: string };
};

export function createAgentContext(job: Job, verification: VerificationBundle, db: ProofPayDb): AgentRunContext {
  const cap = verification.decision.captureAmount;
  return { db, job, verification, capCents: cap ? toCents(cap.value) : 0 };
}

export const ProposeSettlementInput = z.object({
  kind: z.enum(["FULL", "PARTIAL", "VOID"]),
  captureAmount: z
    .string()
    .regex(/^\d{1,9}(\.\d{1,2})?$/)
    .optional()
    .describe('Decimal amount to capture, e.g. "96.00". Omit for VOID.'),
  explanation: z.string().min(1).max(600).describe("Plain-language reason citing criterion ids. Under 80 words."),
});

/** Record a proposal, clamped to what the verification decision allows. Moves no money. */
export function proposeSettlement(ctx: AgentRunContext, input: z.infer<typeof ProposeSettlementInput>) {
  const totalCents = toCents(ctx.job.amount.value);
  const requested =
    input.kind === "VOID" ? 0 : input.captureAmount ? toCents(input.captureAmount) : input.kind === "FULL" ? totalCents : ctx.capCents;
  const captureCents = Math.min(requested, ctx.capCents);
  const clamped = captureCents < requested;
  if (clamped) {
    console.warn(
      `[agent] proposal for ${ctx.job.id} clamped from ${fromCents(requested)} to ${fromCents(captureCents)} (decision limit)`,
    );
  }
  ctx.proposal = {
    kind: captureCents === 0 ? "VOID" : captureCents === totalCents ? "FULL" : "PARTIAL",
    captureCents,
    explanation: input.explanation,
    ...(clamped ? { clampedFromCents: requested } : {}),
  };
  return {
    recorded: true,
    captureAmount: fromCents(captureCents),
    releaseAmount: fromCents(totalCents - captureCents),
    clamped,
    note: "Recorded as a proposal. No money moves until the customer or a reviewer approves.",
  };
}

export const RequestMoreEvidenceInput = z.object({
  criterionId: z.string().min(1).max(50),
  instruction: z.string().min(1).max(300).describe("The exact photo the worker should add."),
});

/** Ask the worker for one specific photo (recorded as an event only). */
export function requestMoreEvidence(ctx: AgentRunContext, input: z.infer<typeof RequestMoreEvidenceInput>) {
  if (!ctx.job.criteria.some((criterion) => criterion.id === input.criterionId)) {
    return { recorded: false, error: `Unknown criterion id ${input.criterionId}` };
  }
  insertEvent(
    {
      jobId: ctx.job.id,
      type: "AGENT_MESSAGE",
      actor: "agent",
      data: { kind: "EVIDENCE_REQUEST", criterionId: input.criterionId, instruction: input.instruction },
    },
    ctx.db,
  );
  return { recorded: true };
}

export const EscalateInput = z.object({ reason: z.string().min(1).max(300) });

export function escalateToHuman(ctx: AgentRunContext, input: z.infer<typeof EscalateInput>) {
  ctx.escalation = { reason: input.reason };
  return { recorded: true, note: "A human reviewer will decide." };
}

function jobSummary(job: Job) {
  return {
    id: job.id,
    title: job.title,
    description: job.description,
    category: job.category,
    amount: job.amount,
    status: job.status,
    criteria: job.criteria.map(({ id, label, required, weight }) => ({ id, label, required, weight })),
    heldByPayPal: job.payment?.authorized ?? null,
  };
}

function verificationSummary(verification: VerificationBundle) {
  return {
    id: verification.id,
    decision: verification.decision,
    verdicts: verification.report.verdicts.map(({ criterionId, verdict, confidence, rationale }) => ({
      criterionId,
      verdict,
      confidence,
      rationale,
    })),
    sameScene: verification.report.sameScene,
    livenessCodeFound: verification.report.livenessCode.found,
    flags: verification.forensics.flags.map(({ code, level, message }) => ({ code, level, message })),
  };
}

/** Facts handed to the model up front; the same data the read tools return. */
export function agentBriefing(ctx: AgentRunContext): string {
  return JSON.stringify({ job: jobSummary(ctx.job), verification: verificationSummary(ctx.verification) });
}

export function buildAgentTools(ctx: AgentRunContext): ToolSet {
  const tools: ToolSet = {
    get_job: tool({
      description: "Read the job: title, amount, checklist and status.",
      inputSchema: z.object({}),
      execute: async () => jobSummary(ctx.job),
    }),
    get_verification: tool({
      description: "Read the AI inspection: per-criterion verdicts, forensics flags and the decision.",
      inputSchema: z.object({}),
      execute: async () => verificationSummary(ctx.verification),
    }),
    propose_settlement: tool({
      description:
        "Record a settlement proposal for the customer. It cannot exceed the decision's capture amount and never moves money.",
      inputSchema: ProposeSettlementInput,
      execute: async (input) => proposeSettlement(ctx, input),
    }),
    request_more_evidence: tool({
      description: "Ask the worker for one specific additional photo for a criterion.",
      inputSchema: RequestMoreEvidenceInput,
      execute: async (input) => requestMoreEvidence(ctx, input),
    }),
    escalate_to_human: tool({
      description: "Send the job to a human reviewer when the evidence is unclear or looks fraudulent.",
      inputSchema: EscalateInput,
      execute: async (input) => escalateToHuman(ctx, input),
    }),
    draft_evidence_pack: tool({
      description: "Draft the Markdown evidence pack (job, verdicts, forensics, timeline, PayPal ids).",
      inputSchema: z.object({}),
      execute: async () => ({ markdown: await buildEvidencePack(ctx.job.id, ctx.db) }),
    }),
  };

  // PayPal Agent Toolkit, read-only. Not loaded in mock mode (no credentials).
  if (!getEnv().PAYPAL_MOCK) {
    tools.get_order = tool({
      description: "PayPal Agent Toolkit: read this job's PayPal order.",
      inputSchema: z.object({}),
      execute: async () =>
        ctx.job.payment?.orderId
          ? callToolkit("get_order", { id: ctx.job.payment.orderId })
          : { error: "This job has no PayPal order." },
    });
    tools.list_disputes = tool({
      description: "PayPal Agent Toolkit: list PayPal disputes for the merchant account.",
      inputSchema: z.object({}),
      execute: async () => callToolkit("list_disputes", {}),
    });
    tools.get_dispute = tool({
      description: "PayPal Agent Toolkit: read one PayPal dispute.",
      inputSchema: z.object({ disputeId: z.string().min(1).max(64) }),
      execute: async ({ disputeId }) => callToolkit("get_dispute", { dispute_id: disputeId }),
    });
  }
  return tools;
}
