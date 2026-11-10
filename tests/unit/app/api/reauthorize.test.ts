import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as reauthorizeRoute } from "@/app/api/jobs/[id]/reauthorize/route";
import { POST as reviewRoute } from "@/app/api/jobs/[id]/review/route";
import { getJob } from "@/server/db/repo";
import { transition } from "@/server/escrow/machine";
import { mockPayPalFetch } from "@/server/paypal/mock";
import { authorizeOrder, createOrder, HONOR_PERIOD_MS } from "@/server/paypal/orders";
import type { EscrowStatus, Job, Role } from "@/shared/contracts";
import { apiRequest, jsonOf, makeJob, params, setupTestApp, teardownTestApp } from "../../helpers";

type Body = { job?: Job; error?: { code: string; message: string } };

beforeEach(() => {
  setupTestApp();
});
afterEach(() => teardownTestApp());

async function jobIn(status: EscrowStatus): Promise<Job> {
  const created = makeJob({ amountCents: 6000 });
  if (status !== "CREATED") {
    const { orderId } = await createOrder(created.id);
    await authorizeOrder(orderId, created.id);
    const steps: EscrowStatus[] =
      status === "AUTHORIZED" ? [] : ["EVIDENCE_SUBMITTED", "VERIFYING", ...(status === "VERIFYING" ? [] : [status])];
    for (const step of steps) transition(created.id, step, "system");
  }
  return getJob(created.id) as Job;
}

async function call(id: string, role: Role | null = "reviewer", headers?: Record<string, string>) {
  const res = await reauthorizeRoute(
    apiRequest("/x", { method: "POST", role: role ?? undefined, headers }),
    params({ id }),
  );
  return { status: res.status, ...(await jsonOf<Body>(res)) };
}

const authStatus = (id: string) =>
  (mockPayPalFetch({ method: "GET", path: `/v2/payments/authorizations/${id}` }).body as { status: string }).status;

describe("POST /api/jobs/:id/reauthorize", () => {
  it("replaces the authorization id, restarts the honor period and keeps the status", async () => {
    const job = await jobIn("HUMAN_REVIEW");
    const oldId = job.payment?.authorizationId ?? "";
    const before = Date.now();
    const res = await call(job.id);
    expect(res.status).toBe(200);
    expect(res.job?.status).toBe("HUMAN_REVIEW");
    const payment = res.job?.payment;
    expect(payment?.authorizationId).toMatch(/^MOCK-AUTH-\d+$/);
    expect(payment?.authorizationId).not.toBe(oldId);
    expect(payment?.authorizationStatus).toBe("CREATED");
    expect(payment?.authorized).toEqual({ currency: "USD", value: "60.00" });
    const honor = Date.parse(payment?.honorPeriodEndsAt ?? "") - before;
    expect(honor).toBeGreaterThanOrEqual(HONOR_PERIOD_MS);
    expect(honor).toBeLessThan(HONOR_PERIOD_MS + 10_000);
    expect(Date.parse(payment?.expiresAt ?? "")).toBeGreaterThan(before + 28 * 86_400_000);
    expect(res.job?.events.at(-1)).toMatchObject({
      type: "PAYPAL_CALL",
      actor: "reviewer",
      data: { op: "reauthorize", ok: true, previousAuthorizationId: oldId, authorizationId: payment?.authorizationId },
    });
    expect(authStatus(oldId)).toBe("VOIDED");
  });

  it("the new authorization is the one that gets captured afterwards", async () => {
    const job = await jobIn("HUMAN_REVIEW");
    const { job: reauthorized } = await call(job.id);
    const newId = reauthorized?.payment?.authorizationId ?? "";
    const res = await reviewRoute(
      apiRequest("/x", { role: "reviewer", body: { decision: "APPROVE", notes: "ok" } }),
      params({ id: job.id }),
    );
    const body = await jsonOf<Body>(res);
    expect(body.job?.status).toBe("CAPTURED");
    expect(body.job?.payment?.captured.value).toBe("60.00");
    expect(authStatus(newId)).toBe("CAPTURED");
  });

  it("can be repeated (each call gets its own PayPal request id)", async () => {
    const job = await jobIn("AUTHORIZED");
    const first = await call(job.id);
    const second = await call(job.id);
    expect(second.status).toBe(200);
    expect(second.job?.payment?.authorizationId).not.toBe(first.job?.payment?.authorizationId);
  });

  it("maps a PayPal refusal to a 409 with a plain message and logs the failed call", async () => {
    const job = await jobIn("AUTHORIZED");
    // Void the hold behind the app's back: PayPal then refuses to reauthorize it.
    mockPayPalFetch({ method: "POST", path: `/v2/payments/authorizations/${job.payment?.authorizationId ?? ""}/void` });
    const res = await call(job.id);
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe("AUTHORIZATION_VOIDED");
    expect(res.error?.message.length).toBeGreaterThan(10);
    const after = getJob(job.id);
    expect(after?.payment?.authorizationId).toBe(job.payment?.authorizationId);
    expect(after?.events.at(-1)).toMatchObject({ type: "PAYPAL_CALL", data: { op: "reauthorize", ok: false } });
  });

  it.each(["CREATED", "VERIFYING", "CAPTURED", "VOIDED"] as const)("refuses a %s job with 409", async (status) => {
    let job: Job;
    if (status === "CAPTURED") {
      job = await jobIn("APPROVED");
      transition(job.id, "CAPTURED", "system");
    } else if (status === "VOIDED") {
      job = await jobIn("AUTHORIZED");
      transition(job.id, "VOIDED", "system");
    } else {
      job = await jobIn(status);
    }
    const res = await call(job.id);
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe("NOT_REAUTHORIZABLE");
  });

  it("is reviewer-only and 404 for an unknown job", async () => {
    const job = await jobIn("AUTHORIZED");
    expect((await call(job.id, "customer")).status).toBe(403);
    expect((await call(job.id, "worker")).status).toBe(403);
    expect((await call(job.id, null)).status).toBe(403);
    expect((await call("nope")).status).toBe(404);
  });

  it("needs the passcode when REVIEWER_PASSCODE is set", async () => {
    teardownTestApp();
    setupTestApp({ REVIEWER_PASSCODE: "open-sesame" });
    const job = await jobIn("AUTHORIZED");
    expect((await call(job.id)).status).toBe(403);
    expect((await call(job.id, "reviewer", { "x-reviewer-passcode": "open-sesame" })).status).toBe(200);
  });
});
