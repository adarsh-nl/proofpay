import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getJob, listEvents } from "@/server/db/repo";
import { authorizeOrder, createOrder, HONOR_PERIOD_MS } from "@/server/paypal/orders";
import { mockPayPalFetch } from "@/server/paypal/mock";
import { makeJob, setupTestApp, teardownTestApp } from "../../helpers";

beforeEach(() => {
  setupTestApp();
});
afterEach(() => teardownTestApp());

describe("createOrder", () => {
  it("creates an AUTHORIZE order tagged with the job id and stores the order id", async () => {
    const job = makeJob({ title: "x".repeat(200) });
    const { orderId } = await createOrder(job.id);
    expect(orderId).toMatch(/^MOCK-ORDER-\d+$/);

    const order = mockPayPalFetch({ method: "GET", path: `/v2/checkout/orders/${orderId}` })
      .body as { intent: string; purchase_units: Array<Record<string, unknown>> };
    expect(order.intent).toBe("AUTHORIZE");
    expect(order.purchase_units[0]).toMatchObject({
      reference_id: job.id,
      custom_id: job.id,
      amount: { currency_code: "USD", value: "60.00" },
    });
    expect(String(order.purchase_units[0]?.description)).toHaveLength(127);

    const stored = getJob(job.id);
    expect(stored?.status).toBe("CREATED");
    expect(stored?.payment?.orderId).toBe(orderId);
    expect(listEvents(job.id).at(-1)).toMatchObject({
      type: "PAYPAL_CALL",
      data: { op: "create_order", orderId },
    });
  });

  it("is idempotent: a second call returns the same order", async () => {
    const job = makeJob();
    const first = await createOrder(job.id);
    const second = await createOrder(job.id);
    expect(second.orderId).toBe(first.orderId);
  });

  it("rejects an unknown job and a job that is not CREATED", async () => {
    await expect(createOrder("nope")).rejects.toMatchObject({ status: 404 });
    const job = makeJob();
    const { orderId } = await createOrder(job.id);
    await authorizeOrder(orderId, job.id);
    await expect(createOrder(job.id)).rejects.toMatchObject({ status: 409, code: "JOB_NOT_PAYABLE" });
  });
});

describe("authorizeOrder", () => {
  it("stores the authorization, generates a 4-digit code and moves the job to AUTHORIZED", async () => {
    const job = makeJob();
    const { orderId } = await createOrder(job.id);
    const before = Date.now();
    const authorized = await authorizeOrder(orderId, job.id);

    expect(authorized.status).toBe("AUTHORIZED");
    expect(authorized.livenessCode).toMatch(/^[1-9]\d{3}$/);
    const payment = authorized.payment;
    expect(payment).toMatchObject({
      orderId,
      authorizationStatus: "CREATED",
      authorized: { currency: "USD", value: "60.00" },
      captured: { currency: "USD", value: "0.00" },
      captureIds: [],
    });
    expect(payment?.authorizationId).toMatch(/^MOCK-AUTH-\d+$/);
    const expiresInDays = (Date.parse(payment?.expiresAt ?? "") - before) / 86_400_000;
    expect(expiresInDays).toBeGreaterThan(28.9);
    expect(expiresInDays).toBeLessThan(29.1);
    const honor = Date.parse(payment?.honorPeriodEndsAt ?? "") - before;
    expect(honor).toBeGreaterThanOrEqual(HONOR_PERIOD_MS);
    expect(honor).toBeLessThan(HONOR_PERIOD_MS + 5000);

    const liveness = authorized.criteria.find((c) => c.id === "cL");
    expect(liveness?.label).toContain(authorized.livenessCode);
    expect(liveness?.label).not.toContain("{CODE}");

    const events = listEvents(job.id);
    expect(events.at(-1)).toMatchObject({
      type: "STATUS_CHANGED",
      fromStatus: "CREATED",
      toStatus: "AUTHORIZED",
      actor: "customer",
    });
    expect(events.some((e) => e.type === "PAYPAL_CALL" && (e.data as { op: string }).op === "authorize")).toBe(true);
  });

  it("is idempotent: a replay keeps the same authorization and code", async () => {
    const job = makeJob();
    const { orderId } = await createOrder(job.id);
    const first = await authorizeOrder(orderId, job.id);
    const again = await authorizeOrder(orderId, job.id);
    expect(again.livenessCode).toBe(first.livenessCode);
    expect(again.payment?.authorizationId).toBe(first.payment?.authorizationId);
    expect(listEvents(job.id)).toHaveLength(first.events.length);
  });

  it("rejects an order that belongs to another job", async () => {
    const mine = makeJob();
    const other = makeJob();
    const { orderId } = await createOrder(other.id);
    await expect(authorizeOrder(orderId, mine.id)).rejects.toMatchObject({
      status: 400,
      code: "ORDER_JOB_MISMATCH",
    });
    expect(getJob(mine.id)?.status).toBe("CREATED");
    expect(getJob(other.id)?.status).toBe("CREATED");
  });

  it("surfaces an unknown order as a PayPal error and leaves the job CREATED", async () => {
    const job = makeJob();
    await expect(authorizeOrder("MOCK-ORDER-999", job.id)).rejects.toMatchObject({
      name: "PayPalError",
      status: 404,
    });
    expect(getJob(job.id)?.status).toBe("CREATED");
  });

  it("refuses a different order once the job is authorized", async () => {
    const job = makeJob();
    const { orderId } = await createOrder(job.id);
    await authorizeOrder(orderId, job.id);
    await expect(authorizeOrder("MOCK-ORDER-999", job.id)).rejects.toMatchObject({ status: 409 });
  });
});
