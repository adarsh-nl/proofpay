import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as refund } from "@/app/api/jobs/[id]/refund/route";
import { POST as review } from "@/app/api/jobs/[id]/review/route";
import { POST as accept } from "@/app/api/jobs/[id]/settlement/accept/route";
import { POST as decline } from "@/app/api/jobs/[id]/settlement/decline/route";
import { POST as voidRoute } from "@/app/api/jobs/[id]/void/route";
import { getJob, insertEvent } from "@/server/db/repo";
import { transition } from "@/server/escrow/machine";
import { mockPayPalFetch } from "@/server/paypal/mock";
import { authorizeOrder, createOrder } from "@/server/paypal/orders";
import type { EscrowStatus, Job, Role, SettlementProposal } from "@/shared/contracts";
import { apiRequest, jsonOf, makeJob, params, setupTestApp, teardownTestApp } from "../../helpers";

type ErrorBody = { error: { code: string; message: string } };
type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

beforeEach(() => {
  setupTestApp();
});
afterEach(() => teardownTestApp());

async function jobIn(status: EscrowStatus, amountCents = 12000): Promise<Job> {
  const created = makeJob({ category: "cleaning", amountCents });
  const { orderId } = await createOrder(created.id);
  await authorizeOrder(orderId, created.id);
  const path: EscrowStatus[] =
    status === "AUTHORIZED" ? [] : ["EVIDENCE_SUBMITTED", "VERIFYING", ...(status === "VERIFYING" ? [] : [status])];
  for (const step of path) transition(created.id, step, "system");
  const job = getJob(created.id);
  if (!job) throw new Error("job missing");
  return job;
}

function propose(jobId: string, capture = "96.00", release = "24.00"): SettlementProposal {
  const proposal: SettlementProposal = {
    proposalId: `prp_${jobId.slice(0, 8)}_${capture}`,
    kind: "PARTIAL_CAPTURE",
    captureAmount: { currency: "USD", value: capture },
    releaseAmount: { currency: "USD", value: release },
    explanation: "4 of 5 checklist items were verified (c4 failed).",
    basedOnVerificationId: "ver_test",
  };
  insertEvent({ jobId, type: "AGENT_MESSAGE", actor: "agent", data: proposal });
  return proposal;
}

async function call(handler: Handler, id: string, role: Role | undefined, body: unknown) {
  const res = await handler(apiRequest("/x", { role, body }), params({ id }));
  const json = await jsonOf<{ job?: Job } & Partial<ErrorBody>>(res);
  return { status: res.status, job: json.job, error: json.error };
}

const authStatus = (job: Job) =>
  (
    mockPayPalFetch({
      method: "GET",
      path: `/v2/payments/authorizations/${job.payment?.authorizationId ?? ""}`,
    }).body as { status: string }
  ).status;

describe("POST /api/jobs/:id/settlement/accept", () => {
  it("captures the proposed amount after the customer accepts", async () => {
    const job = await jobIn("PARTIAL");
    const proposal = propose(job.id);
    const res = await call(accept, job.id, "customer", { proposalId: proposal.proposalId });
    expect(res.status).toBe(200);
    expect(res.job?.status).toBe("CAPTURED");
    expect(res.job?.payment?.captured).toEqual({ currency: "USD", value: "96.00" });
    expect(res.job?.payment?.captureIds).toHaveLength(1);
    expect(res.job?.events.some((e) => e.type === "SETTLEMENT_ACCEPTED" && e.actor === "customer")).toBe(true);
    expect(authStatus(job)).toBe("CAPTURED");
  });

  it("rejects a stale proposal id, a missing proposal, the wrong role and the wrong state", async () => {
    const job = await jobIn("PARTIAL");
    const none = await call(accept, job.id, "customer", { proposalId: "prp_x" });
    expect(none.status).toBe(409);
    expect(none.error?.code).toBe("PROPOSAL_NOT_CURRENT");
    const proposal = propose(job.id);
    expect((await call(accept, job.id, "worker", { proposalId: proposal.proposalId })).status).toBe(403);
    expect((await call(accept, job.id, "customer", {})).status).toBe(400);
    expect(getJob(job.id)?.status).toBe("PARTIAL");
    expect(getJob(job.id)?.events.some((e) => e.type === "SETTLEMENT_ACCEPTED")).toBe(false);

    const authorized = await jobIn("AUTHORIZED");
    const wrongState = await call(accept, authorized.id, "customer", { proposalId: "prp_x" });
    expect(wrongState.status).toBe(409);
    expect(wrongState.error?.code).toBe("NO_OPEN_PROPOSAL");
  });

  it("uses the latest proposal when there are several", async () => {
    const job = await jobIn("PARTIAL");
    const old = propose(job.id, "90.00", "30.00");
    const latest = propose(job.id, "96.00", "24.00");
    expect((await call(accept, job.id, "customer", { proposalId: old.proposalId })).status).toBe(409);
    const res = await call(accept, job.id, "customer", { proposalId: latest.proposalId });
    expect(res.job?.payment?.captured.value).toBe("96.00");
  });
});

describe("POST /api/jobs/:id/settlement/decline", () => {
  it.each(["customer", "worker"] as const)("moves the job to HUMAN_REVIEW when the %s declines", async (role) => {
    const job = await jobIn("PARTIAL");
    const proposal = propose(job.id);
    const res = await call(decline, job.id, role, { proposalId: proposal.proposalId, reason: "Not fair" });
    expect(res.status).toBe(200);
    expect(res.job?.status).toBe("HUMAN_REVIEW");
    expect(res.job?.payment?.captureIds).toEqual([]);
    expect(res.job?.events.at(-1)).toMatchObject({ fromStatus: "PARTIAL", toStatus: "HUMAN_REVIEW", actor: role });
  });

  it("rejects the reviewer role and a missing reason", async () => {
    const job = await jobIn("PARTIAL");
    const proposal = propose(job.id);
    expect((await call(decline, job.id, "reviewer", { proposalId: proposal.proposalId, reason: "x" })).status).toBe(403);
    expect((await call(decline, job.id, "customer", { proposalId: proposal.proposalId })).status).toBe(400);
  });
});

describe("POST /api/jobs/:id/review", () => {
  it("APPROVE captures the full amount", async () => {
    const job = await jobIn("HUMAN_REVIEW");
    const res = await call(review, job.id, "reviewer", { decision: "APPROVE", notes: "Looks done." });
    expect(res.status).toBe(200);
    expect(res.job?.status).toBe("CAPTURED");
    expect(res.job?.payment?.captured.value).toBe("120.00");
    const statuses = res.job?.events.filter((e) => e.type === "STATUS_CHANGED").map((e) => e.toStatus);
    expect(statuses?.slice(-2)).toEqual(["APPROVED", "CAPTURED"]);
    expect(res.job?.events.some((e) => e.type === "REVIEW" && e.actor === "reviewer")).toBe(true);
    expect(res.job?.livenessCode).toMatch(/^\d{4}$/);
  });

  it("PARTIAL captures the reviewer's amount", async () => {
    const job = await jobIn("HUMAN_REVIEW");
    const res = await call(review, job.id, "reviewer", {
      decision: "PARTIAL",
      amount: { currency: "USD", value: "50.00" },
      notes: "Half done.",
    });
    expect(res.job?.status).toBe("CAPTURED");
    expect(res.job?.payment?.captured.value).toBe("50.00");
    expect(authStatus(job)).toBe("CAPTURED");
  });

  it("REJECT voids the hold in the same request", async () => {
    const job = await jobIn("HUMAN_REVIEW");
    const res = await call(review, job.id, "reviewer", { decision: "REJECT", notes: "Reused photo." });
    expect(res.job?.status).toBe("VOIDED");
    const statuses = res.job?.events.filter((e) => e.type === "STATUS_CHANGED").map((e) => e.toStatus);
    expect(statuses?.slice(-2)).toEqual(["REJECTED", "VOIDED"]);
    expect(res.job?.payment?.captureIds).toEqual([]);
    expect(authStatus(job)).toBe("VOIDED");
  });

  it("rejects a partial amount above the hold, a missing amount and the wrong currency", async () => {
    const job = await jobIn("HUMAN_REVIEW");
    const over = await call(review, job.id, "reviewer", {
      decision: "PARTIAL",
      amount: { currency: "USD", value: "120.01" },
      notes: "",
    });
    expect(over.status).toBe(400);
    expect(over.error?.code).toBe("AMOUNT_OUT_OF_RANGE");
    expect((await call(review, job.id, "reviewer", { decision: "PARTIAL", notes: "" })).status).toBe(400);
    const eur = await call(review, job.id, "reviewer", {
      decision: "PARTIAL",
      amount: { currency: "EUR", value: "10.00" },
      notes: "",
    });
    expect(eur.status).toBe(400);
    const after = getJob(job.id);
    expect(after?.status).toBe("HUMAN_REVIEW");
    expect(after?.events.some((e) => e.type === "REVIEW")).toBe(false);
  });

  it("rejects other roles (403) and jobs that are not in HUMAN_REVIEW (409)", async () => {
    const job = await jobIn("HUMAN_REVIEW");
    expect((await call(review, job.id, "customer", { decision: "APPROVE", notes: "" })).status).toBe(403);
    const authorized = await jobIn("AUTHORIZED");
    const res = await call(review, authorized.id, "reviewer", { decision: "APPROVE", notes: "" });
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe("ILLEGAL_TRANSITION");
    expect((await call(review, "nope", "reviewer", { decision: "APPROVE", notes: "" })).status).toBe(404);
  });

  it("needs the passcode when REVIEWER_PASSCODE is set", async () => {
    teardownTestApp();
    setupTestApp({ REVIEWER_PASSCODE: "open-sesame" });
    const job = await jobIn("HUMAN_REVIEW");
    const denied = await call(review, job.id, "reviewer", { decision: "APPROVE", notes: "" });
    expect(denied.status).toBe(403);
    expect(denied.error?.code).toBe("REVIEWER_PASSCODE_REQUIRED");
    const res = await review(
      apiRequest("/x", {
        role: "reviewer",
        body: { decision: "APPROVE", notes: "" },
        headers: { "x-reviewer-passcode": "open-sesame" },
      }),
      params({ id: job.id }),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/jobs/:id/void", () => {
  it("lets the customer cancel an AUTHORIZED hold", async () => {
    const job = await jobIn("AUTHORIZED");
    const res = await call(voidRoute, job.id, "customer", { reason: "Changed my mind" });
    expect(res.status).toBe(200);
    expect(res.job?.status).toBe("VOIDED");
    expect(res.job?.events.some((e) => e.type === "VOID_REQUESTED")).toBe(true);
    expect(authStatus(job)).toBe("VOIDED");
  });

  it.each(["customer", "reviewer"] as const)("lets the %s void a REJECTED job", async (role) => {
    const job = await jobIn("REJECTED");
    const res = await call(voidRoute, job.id, role, { reason: "No retry" });
    expect(res.job?.status).toBe("VOIDED");
  });

  it("rejects the worker (403), a missing reason (400) and other states (409)", async () => {
    const job = await jobIn("AUTHORIZED");
    expect((await call(voidRoute, job.id, "worker", { reason: "x" })).status).toBe(403);
    expect((await call(voidRoute, job.id, "customer", {})).status).toBe(400);
    const review = await jobIn("HUMAN_REVIEW");
    const res = await call(voidRoute, review.id, "customer", { reason: "x" });
    expect(res.status).toBe(409);
    expect(getJob(review.id)?.status).toBe("HUMAN_REVIEW");
  });
});

describe("POST /api/jobs/:id/refund", () => {
  async function captured(): Promise<Job> {
    const job = await jobIn("HUMAN_REVIEW");
    await call(review, job.id, "reviewer", { decision: "APPROVE", notes: "" });
    return job;
  }

  it("refunds the full capture when no amount is given", async () => {
    const job = await captured();
    const res = await call(refund, job.id, "reviewer", { reason: "Customer complaint upheld" });
    expect(res.status).toBe(200);
    expect(res.job?.status).toBe("REFUNDED");
    expect(res.job?.payment?.refunded.value).toBe("120.00");
  });

  it("refunds a partial amount", async () => {
    const job = await captured();
    const res = await call(refund, job.id, "reviewer", {
      amount: { currency: "USD", value: "20.00" },
      reason: "Goodwill",
    });
    expect(res.job?.status).toBe("REFUNDED");
    expect(res.job?.payment?.refunded.value).toBe("20.00");
  });

  it("rejects other roles (403), an amount above the capture (403) and uncaptured jobs (409)", async () => {
    const job = await captured();
    expect((await call(refund, job.id, "customer", { reason: "x" })).status).toBe(403);
    const over = await call(refund, job.id, "reviewer", {
      amount: { currency: "USD", value: "120.01" },
      reason: "x",
    });
    expect(over.status).toBe(403);
    expect(getJob(job.id)?.status).toBe("CAPTURED");
    const authorized = await jobIn("AUTHORIZED");
    expect((await call(refund, authorized.id, "reviewer", { reason: "x" })).status).toBe(409);
  });
});
