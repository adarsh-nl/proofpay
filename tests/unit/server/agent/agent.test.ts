import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as evidencePackRoute } from "@/app/api/jobs/[id]/agent/evidence-pack/route";
import { POST as acceptRoute } from "@/app/api/jobs/[id]/settlement/accept/route";
import { buildEvidencePack } from "@/server/agent/evidence-pack";
import { assertCanCapture, assertCanRefund } from "@/server/agent/policy";
import { runSettlementAgent, templateExplanation } from "@/server/agent/settlement-agent";
import { createAgentContext, proposeSettlement, requestMoreEvidence } from "@/server/agent/tools";
import { getJob, insertEvent, insertVerification } from "@/server/db/repo";
import { transition } from "@/server/escrow/machine";
import { settle } from "@/server/escrow/settle";
import { PolicyError } from "@/server/http/errors";
import { findLatestProposal } from "@/server/jobs/settlement";
import { authorizeOrder, createOrder } from "@/server/paypal/orders";
import type { Decision, DecisionOutcome, EscrowStatus, Job, VerificationBundle } from "@/shared/contracts";
import { apiRequest, jsonOf, makeJob, params, setupTestApp, teardownTestApp } from "../../helpers";

beforeEach(() => {
  setupTestApp();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  teardownTestApp();
  vi.restoreAllMocks();
});

const usd = (value: string) => ({ currency: "USD", value });

/** Cleaning job ($120) with a stored verification: c4 fails, everything else passes. */
async function verifiedJob(
  outcome: DecisionOutcome = "PARTIAL",
  overrides: Partial<Decision> = {},
  status: EscrowStatus | "VERIFYING" = outcome,
): Promise<{ job: Job; verification: VerificationBundle }> {
  const created = makeJob({ category: "cleaning", amountCents: 12000 });
  const { orderId } = await createOrder(created.id);
  await authorizeOrder(orderId, created.id);
  transition(created.id, "EVIDENCE_SUBMITTED", "worker");
  transition(created.id, "VERIFYING", "system");
  const verification = insertVerification({
    id: "ver_test_1",
    jobId: created.id,
    attempt: 1,
    model: "mock",
    mock: true,
    report: {
      verdicts: created.criteria.map((criterion) => ({
        criterionId: criterion.id,
        verdict: criterion.id === "c4" ? "FAIL" : "PASS",
        confidence: criterion.id === "c4" ? 0.88 : 0.95,
        rationale: criterion.id === "c4" ? "Grease is still visible on the oven interior." : "Looks done.",
        evidence: [{ imageId: "A1", box_2d: [100, 100, 300, 500], note: "area | checked" }],
      })),
      sameScene: { verdict: "SAME", confidence: 0.9, rationale: "Same room." },
      livenessCode: { found: true, readValue: "1234", imageId: "A1" },
      imageQualityIssues: ["NONE"],
      summary: "Four of five items verified.",
    },
    forensics:
      outcome === "HUMAN_REVIEW"
        ? { flags: [{ code: "NEAR_DUPLICATE", level: "HIGH", message: "Photo reused from another job.", evidenceIds: ["e1"] }] }
        : { flags: [] },
    decision: {
      outcome,
      score: 0.8,
      ...(outcome === "PARTIAL" ? { captureAmount: usd("96.00") } : {}),
      reasons: ["c4 FAIL (0.88)"],
      ...overrides,
    },
  });
  if (status !== "VERIFYING") transition(created.id, status, "system");
  const job = getJob(created.id);
  if (!job) throw new Error("job missing");
  return { job, verification };
}

describe("policy.assertCanCapture", () => {
  it("refuses a partial capture without any approval", async () => {
    const { job } = await verifiedJob();
    expect(() => assertCanCapture(job.id, 9600)).toThrow(PolicyError);
    expect(() => assertCanCapture(job.id, 9600)).toThrow(expect.objectContaining({ code: "APPROVAL_REQUIRED" }));
  });

  it("allows up to decision.captureAmount once the customer accepted", async () => {
    const { job } = await verifiedJob();
    insertEvent({ jobId: job.id, type: "SETTLEMENT_ACCEPTED", actor: "customer", data: {} });
    expect(assertCanCapture(job.id, 9600)).toBe("customer");
    expect(assertCanCapture(job.id, 5000)).toBe("customer");
    expect(() => assertCanCapture(job.id, 9601)).toThrow(expect.objectContaining({ code: "AMOUNT_EXCEEDS_DECISION" }));
  });

  it("ignores an acceptance event that did not come from the customer", async () => {
    const { job } = await verifiedJob();
    insertEvent({ jobId: job.id, type: "SETTLEMENT_ACCEPTED", actor: "agent", data: {} });
    expect(() => assertCanCapture(job.id, 9600)).toThrow(expect.objectContaining({ code: "APPROVAL_REQUIRED" }));
  });

  it("lets a reviewer decision go up to the authorized amount, never above", async () => {
    const { job } = await verifiedJob("HUMAN_REVIEW");
    expect(() => assertCanCapture(job.id, 5000)).toThrow(expect.objectContaining({ code: "APPROVAL_REQUIRED" }));
    insertEvent({ jobId: job.id, type: "REVIEW", actor: "reviewer", data: { decision: "PARTIAL" } });
    expect(assertCanCapture(job.id, 12000)).toBe("reviewer");
    expect(() => assertCanCapture(job.id, 12001)).toThrow(
      expect.objectContaining({ code: "AMOUNT_EXCEEDS_AUTHORIZATION" }),
    );
  });

  it("does not count a reviewer REJECT or REFUND as a capture approval", async () => {
    const { job } = await verifiedJob("HUMAN_REVIEW");
    insertEvent({ jobId: job.id, type: "REVIEW", actor: "reviewer", data: { decision: "REJECT" } });
    insertEvent({ jobId: job.id, type: "REVIEW", actor: "reviewer", data: { decision: "REFUND" } });
    expect(() => assertCanCapture(job.id, 5000)).toThrow(expect.objectContaining({ code: "APPROVAL_REQUIRED" }));
  });

  it("allows only the automatic full capture of an APPROVED verification", async () => {
    const { job } = await verifiedJob("APPROVED", { score: 1, captureAmount: usd("120.00"), reasons: [] });
    expect(assertCanCapture(job.id, 12000)).toBe("auto-approved");
    expect(() => assertCanCapture(job.id, 6000)).toThrow(expect.objectContaining({ code: "APPROVAL_REQUIRED" }));
  });

  it("rejects zero, negative and fractional amounts", async () => {
    const { job } = await verifiedJob();
    for (const amount of [0, -1, 10.5]) {
      expect(() => assertCanCapture(job.id, amount)).toThrow(expect.objectContaining({ code: "INVALID_AMOUNT" }));
    }
  });
});

describe("settle goes through the policy gate", () => {
  it("refuses a partial capture when the only approval is not a human one", async () => {
    const { job } = await verifiedJob();
    insertEvent({ jobId: job.id, type: "SETTLEMENT_ACCEPTED", actor: "agent", data: {} });
    await expect(settle(job.id, { kind: "PARTIAL", amountCents: 9600 })).rejects.toMatchObject({
      status: 403,
      code: "APPROVAL_REQUIRED",
    });
    expect(getJob(job.id)?.status).toBe("PARTIAL");
    expect(getJob(job.id)?.payment?.captureIds).toEqual([]);
  });

  it("refuses to capture more than the decision after a customer acceptance", async () => {
    const { job } = await verifiedJob();
    insertEvent({ jobId: job.id, type: "SETTLEMENT_ACCEPTED", actor: "customer", data: {} });
    await expect(settle(job.id, { kind: "PARTIAL", amountCents: 12000 })).rejects.toMatchObject({
      code: "AMOUNT_EXCEEDS_DECISION",
    });
    expect(getJob(job.id)?.payment?.captureIds).toEqual([]);
  });
});

describe("policy.assertCanRefund", () => {
  it("needs a reviewer refund decision", async () => {
    const { job } = await verifiedJob();
    expect(() => assertCanRefund(job.id)).toThrow(expect.objectContaining({ code: "REVIEWER_APPROVAL_REQUIRED" }));
    insertEvent({ jobId: job.id, type: "REVIEW", actor: "customer", data: { decision: "REFUND" } });
    expect(() => assertCanRefund(job.id)).toThrow(PolicyError);
    insertEvent({ jobId: job.id, type: "REVIEW", actor: "reviewer", data: { decision: "REFUND" } });
    expect(() => assertCanRefund(job.id)).not.toThrow();
  });
});

describe("runSettlementAgent (mock mode)", () => {
  it("writes a PARTIAL proposal of $96 / $24 that cites the failed criterion", async () => {
    const { job, verification } = await verifiedJob();
    const event = await runSettlementAgent(job.id);
    expect(event?.type).toBe("AGENT_MESSAGE");
    expect(event?.actor).toBe("agent");
    const proposal = findLatestProposal(getJob(job.id) as Job);
    expect(proposal).toMatchObject({
      kind: "PARTIAL_CAPTURE",
      captureAmount: usd("96.00"),
      releaseAmount: usd("24.00"),
      basedOnVerificationId: verification.id,
    });
    expect(proposal?.proposalId).toMatch(/^prp_[0-9a-f]{12}$/);
    expect(proposal?.explanation).toContain("c4 (FAIL)");
    expect(proposal?.explanation).toContain("4 of 5");
    expect(proposal?.explanation.split(/\s+/).length).toBeLessThanOrEqual(80);
    expect((event?.data as { proposal: unknown; mock: boolean }).proposal).toEqual(proposal);
    expect((event?.data as { mock: boolean }).mock).toBe(true);
    expect(getJob(job.id)?.status).toBe("PARTIAL");
    expect(getJob(job.id)?.payment?.captureIds).toEqual([]);
  });

  it("is deterministic: two runs give the same proposal", async () => {
    const { job } = await verifiedJob();
    const first = await runSettlementAgent(job.id);
    const second = await runSettlementAgent(job.id);
    expect(second?.data).toEqual(first?.data);
  });

  it("explains HUMAN_REVIEW with the flag code and writes no proposal", async () => {
    const { job } = await verifiedJob("HUMAN_REVIEW");
    const event = await runSettlementAgent(job.id);
    const data = event?.data as { kind: string; explanation: string };
    expect(data.kind).toBe("EXPLANATION");
    expect(data.explanation).toContain("NEAR_DUPLICATE");
    expect(data.explanation).toContain("human reviewer");
    expect(findLatestProposal(getJob(job.id) as Job)).toBeUndefined();
  });

  it("explains REJECTED and returns null without a verification", async () => {
    const { job, verification } = await verifiedJob("REJECTED");
    expect(templateExplanation(job, verification)).toContain("nothing is captured");
    const bare = makeJob();
    await expect(runSettlementAgent(bare.id)).resolves.toBeNull();
    await expect(runSettlementAgent("nope")).resolves.toBeNull();
  });

  it("falls back to the template when the model call fails", async () => {
    const { job } = await verifiedJob();
    const broken = { modelId: "broken", provider: "test", specificationVersion: "v4" } as never;
    const event = await runSettlementAgent(job.id, undefined, { mock: false, model: broken });
    const data = event?.data as { model: string; explanation: string; captureAmount: { value: string } };
    expect(data.model).toBe("template");
    expect(data.captureAmount.value).toBe("96.00");
    expect(data.explanation).toContain("c4 (FAIL)");
  });

  it("the customer can accept the agent's proposal end to end", async () => {
    const { job } = await verifiedJob();
    await runSettlementAgent(job.id);
    const proposal = findLatestProposal(getJob(job.id) as Job);
    const res = await acceptRoute(
      apiRequest("/x", { role: "customer", body: { proposalId: proposal?.proposalId } }),
      params({ id: job.id }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf<{ job: Job }>(res);
    expect(body.job.status).toBe("CAPTURED");
    expect(body.job.payment?.captured).toEqual(usd("96.00"));
  });
});

describe("agent tools", () => {
  it("propose_settlement clamps to decision.captureAmount and records the clamp", async () => {
    const { job, verification } = await verifiedJob();
    const ctx = createAgentContext(job, verification, undefined as never);
    const over = proposeSettlement(ctx, { kind: "FULL", explanation: "Pay it all." });
    expect(over).toMatchObject({ captureAmount: "96.00", releaseAmount: "24.00", clamped: true });
    expect(ctx.proposal).toMatchObject({ kind: "PARTIAL", captureCents: 9600, clampedFromCents: 12000 });

    const lower = proposeSettlement(ctx, { kind: "PARTIAL", captureAmount: "90.00", explanation: "c4 failed." });
    expect(lower).toMatchObject({ captureAmount: "90.00", clamped: false });
    const none = proposeSettlement(ctx, { kind: "VOID", explanation: "Nothing done." });
    expect(none.captureAmount).toBe("0.00");
    expect(ctx.proposal?.kind).toBe("VOID");
  });

  it("a proposal can never exceed zero when the decision has no capture amount", async () => {
    const { job, verification } = await verifiedJob("HUMAN_REVIEW");
    const ctx = createAgentContext(job, verification, undefined as never);
    expect(proposeSettlement(ctx, { kind: "FULL", explanation: "x" }).captureAmount).toBe("0.00");
  });

  it("request_more_evidence records an event for a known criterion only", async () => {
    const { job, verification } = await verifiedJob();
    const { getDb } = await import("@/server/db/client");
    const ctx = createAgentContext(job, verification, getDb());
    expect(requestMoreEvidence(ctx, { criterionId: "zz", instruction: "x" }).recorded).toBe(false);
    expect(requestMoreEvidence(ctx, { criterionId: "c4", instruction: "Photograph the oven with the door open." }).recorded).toBe(true);
    expect(getJob(job.id)?.events.at(-1)).toMatchObject({
      type: "AGENT_MESSAGE",
      data: { kind: "EVIDENCE_REQUEST", criterionId: "c4" },
    });
    expect(getJob(job.id)?.payment?.captureIds).toEqual([]);
  });
});

describe("evidence pack", () => {
  it("contains every criterion id, the verdicts, the PayPal ids and the order state", async () => {
    const { job } = await verifiedJob();
    const markdown = await buildEvidencePack(job.id);
    expect(markdown).toContain(`\`${job.id}\``);
    for (const criterion of job.criteria) expect(markdown).toContain(`| ${criterion.id} |`);
    expect(markdown).toContain("| c4 | FAIL | 0.88 |");
    expect(markdown).toContain("A1 [100,100,300,500]");
    expect(markdown).toContain(job.payment?.orderId ?? "missing");
    expect(markdown).toContain(job.payment?.authorizationId ?? "missing");
    expect(markdown).toMatch(/Order status \(PayPal Agent Toolkit `get_order`, mock\): COMPLETED/);
    expect(markdown).toContain("**PARTIAL**");
    expect(markdown).toContain("AUTHORIZED → EVIDENCE_SUBMITTED");
    expect(markdown).not.toContain("area | checked");
  });

  it("is deterministic and lists forensics flags", async () => {
    const { job } = await verifiedJob("HUMAN_REVIEW");
    const first = await buildEvidencePack(job.id);
    expect(await buildEvidencePack(job.id)).toBe(first);
    expect(first).toContain("| HIGH | NEAR_DUPLICATE | Photo reused from another job. | e1 |");
  });

  it("uses the injected get_order result and survives it being unavailable", async () => {
    const { job } = await verifiedJob();
    const live = await buildEvidencePack(job.id, undefined, {
      getOrderState: async () => ({ status: "APPROVED", source: "paypal-agent-toolkit" }),
    });
    expect(live).toContain("Order status (PayPal Agent Toolkit `get_order`): APPROVED");
    const down = await buildEvidencePack(job.id, undefined, {
      getOrderState: async () => ({ status: "UNAVAILABLE", source: "unavailable" }),
    });
    expect(down).toContain("UNAVAILABLE");
  });

  it("POST /api/jobs/:id/agent/evidence-pack returns markdown to the reviewer only", async () => {
    const { job } = await verifiedJob();
    const call = (role: "reviewer" | "customer", id = job.id) =>
      evidencePackRoute(apiRequest("/x", { role, body: {} }), params({ id }));
    expect((await call("customer")).status).toBe(403);
    expect((await call("reviewer", "nope")).status).toBe(404);
    const res = await call("reviewer");
    expect(res.status).toBe(200);
    const body = await jsonOf<{ markdown: string }>(res);
    expect(body.markdown).toContain("# ProofPay evidence pack");
    expect(body.markdown).toContain(job.id);
  });
});
