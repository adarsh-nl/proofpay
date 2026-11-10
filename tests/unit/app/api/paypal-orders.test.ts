import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as authorize } from "@/app/api/paypal/orders/[orderId]/authorize/route";
import { POST as createOrder } from "@/app/api/paypal/orders/route";
import type { Job } from "@/shared/contracts";
import { getJob } from "@/server/db/repo";
import { apiRequest, jsonOf, makeJob, params, setupTestApp, teardownTestApp } from "../../helpers";

beforeEach(() => {
  setupTestApp();
});
afterEach(() => teardownTestApp());

const none = params({});

describe("POST /api/paypal/orders", () => {
  it("returns 201 { orderId } for the customer", async () => {
    const job = makeJob();
    const res = await createOrder(
      apiRequest("/api/paypal/orders", { role: "customer", body: { jobId: job.id } }),
      none,
    );
    expect(res.status).toBe(201);
    expect((await jsonOf<{ orderId: string }>(res)).orderId).toMatch(/^MOCK-ORDER-/);
  });

  it("rejects the wrong role (403), a bad body (400) and an unknown job (404)", async () => {
    const job = makeJob();
    const wrongRole = await createOrder(
      apiRequest("/api/paypal/orders", { role: "worker", body: { jobId: job.id } }),
      none,
    );
    expect(wrongRole.status).toBe(403);
    const badBody = await createOrder(apiRequest("/api/paypal/orders", { role: "customer", body: {} }), none);
    expect(badBody.status).toBe(400);
    const unknown = await createOrder(
      apiRequest("/api/paypal/orders", { role: "customer", body: { jobId: "nope" } }),
      none,
    );
    expect(unknown.status).toBe(404);
  });
});

describe("POST /api/paypal/orders/:orderId/authorize", () => {
  async function order(jobId: string): Promise<string> {
    const res = await createOrder(
      apiRequest("/api/paypal/orders", { role: "customer", body: { jobId } }),
      none,
    );
    return (await jsonOf<{ orderId: string }>(res)).orderId;
  }

  it("authorizes, returns the job and hides the liveness code from the customer", async () => {
    const job = makeJob();
    const orderId = await order(job.id);
    const res = await authorize(
      apiRequest(`/api/paypal/orders/${orderId}/authorize`, { role: "customer", body: { jobId: job.id } }),
      params({ orderId }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf<{ job: Job }>(res);
    expect(body.job.status).toBe("AUTHORIZED");
    expect(body.job.payment?.authorizationId).toMatch(/^MOCK-AUTH-/);
    expect(body.job.livenessCode).toBeUndefined();
    expect(getJob(job.id)?.livenessCode).toMatch(/^\d{4}$/);
  });

  it("returns 400 for an order of another job and 502 for an unknown order", async () => {
    const mine = makeJob();
    const other = makeJob();
    const otherOrder = await order(other.id);
    const mismatch = await authorize(
      apiRequest("/x", { role: "customer", body: { jobId: mine.id } }),
      params({ orderId: otherOrder }),
    );
    expect(mismatch.status).toBe(400);
    const unknown = await authorize(
      apiRequest("/x", { role: "customer", body: { jobId: mine.id } }),
      params({ orderId: "MOCK-ORDER-404" }),
    );
    expect(unknown.status).toBe(502);
    expect((await jsonOf<{ error: { code: string } }>(unknown)).error.code).toBe("INVALID_RESOURCE_ID");
  });

  it("returns 403 without the customer role", async () => {
    const job = makeJob();
    const orderId = await order(job.id);
    const res = await authorize(
      apiRequest("/x", { role: "reviewer", body: { jobId: job.id } }),
      params({ orderId }),
    );
    expect(res.status).toBe(403);
  });
});
