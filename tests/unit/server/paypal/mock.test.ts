import { beforeEach, describe, expect, it } from "vitest";
import { mockPayPalFetch, resetPayPalMock, type MockRequest } from "@/server/paypal/mock";

type Body = Record<string, unknown>;
const usd = (value: string) => ({ currency_code: "USD", value });

function call(req: MockRequest): { status: number; body: Body } {
  const res = mockPayPalFetch(req);
  return { status: res.status, body: (res.body ?? {}) as Body };
}
const issueOf = (body: Body) => (body.details as Array<{ issue: string }>)[0]?.issue;

function authorize(value = "100.00", custom = "job-1") {
  const order = call({
    method: "POST",
    path: "/v2/checkout/orders",
    requestId: `${custom}:create`,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [{ reference_id: custom, custom_id: custom, amount: usd(value) }],
    },
  });
  const orderId = order.body.id as string;
  const authorized = call({
    method: "POST",
    path: `/v2/checkout/orders/${orderId}/authorize`,
    requestId: `${custom}:authorize`,
  });
  const units = authorized.body.purchase_units as Array<{
    payments: { authorizations: Array<{ id: string; status: string; expiration_time: string }> };
  }>;
  const auth = units[0]?.payments.authorizations[0];
  if (!auth) throw new Error("no authorization");
  return { orderId, order, authorized, auth };
}
const capturePath = (id: string) => `/v2/payments/authorizations/${id}/capture`;
const voidPath = (id: string) => `/v2/payments/authorizations/${id}/void`;

beforeEach(() => resetPayPalMock());

describe("PAYPAL_MOCK fake (C7)", () => {
  it("creates and authorizes an order with PayPal v2 shapes and ids", () => {
    const { orderId, order, authorized, auth } = authorize("60.00");
    expect(order.status).toBe(201);
    expect(orderId).toMatch(/^MOCK-ORDER-\d+$/);
    expect(order.body.status).toBe("CREATED");
    expect(authorized.status).toBe(201);
    expect(authorized.body.status).toBe("COMPLETED");
    expect(auth.id).toMatch(/^MOCK-AUTH-\d+$/);
    expect(auth.status).toBe("CREATED");
    const days = (Date.parse(auth.expiration_time) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(28.99);
    expect(days).toBeLessThanOrEqual(29);

    const fetched = call({ method: "GET", path: `/v2/checkout/orders/${orderId}` });
    const unit = (fetched.body.purchase_units as Array<Body>)[0];
    expect(unit?.custom_id).toBe("job-1");
    expect(unit?.amount).toEqual(usd("60.00"));
  });

  it("refuses a second authorize of the same order", () => {
    const { orderId } = authorize();
    const again = call({ method: "POST", path: `/v2/checkout/orders/${orderId}/authorize` });
    expect(again.status).toBe(422);
    expect(issueOf(again.body)).toBe("ORDER_ALREADY_AUTHORIZED");
  });

  it("captures the full amount when no amount is sent", () => {
    const { auth } = authorize("60.00");
    const capture = call({
      method: "POST",
      path: capturePath(auth.id),
      requestId: "cap-1",
      body: { final_capture: true, invoice_id: "job-1-1" },
    });
    expect(capture.status).toBe(201);
    expect(capture.body).toMatchObject({
      status: "COMPLETED",
      amount: usd("60.00"),
      final_capture: true,
      invoice_id: "job-1-1",
    });
    expect(capture.body.id).toMatch(/^MOCK-CAP-\d+$/);
    const after = call({ method: "GET", path: `/v2/payments/authorizations/${auth.id}` });
    expect(after.body.status).toBe("CAPTURED");
  });

  it("marks the authorization CAPTURED after a partial final capture", () => {
    const { auth } = authorize("100.00");
    const capture = call({
      method: "POST",
      path: capturePath(auth.id),
      body: { amount: usd("80.00"), final_capture: true },
    });
    expect(capture.body.amount).toEqual(usd("80.00"));
    const after = call({ method: "GET", path: `/v2/payments/authorizations/${auth.id}` });
    expect(after.body.status).toBe("CAPTURED");
  });

  it("rejects a capture above the authorized amount", () => {
    const { auth } = authorize("100.00");
    const res = call({
      method: "POST",
      path: capturePath(auth.id),
      body: { amount: usd("100.01"), final_capture: true },
    });
    expect(res.status).toBe(422);
    expect(issueOf(res.body)).toBe("MAX_CAPTURE_AMOUNT_EXCEEDED");
  });

  it("rejects a second capture after a final capture", () => {
    const { auth } = authorize("100.00");
    call({ method: "POST", path: capturePath(auth.id), body: { amount: usd("80.00"), final_capture: true } });
    const second = call({
      method: "POST",
      path: capturePath(auth.id),
      body: { amount: usd("10.00"), final_capture: true },
    });
    expect(second.status).toBe(422);
    expect(issueOf(second.body)).toBe("AUTHORIZATION_ALREADY_CAPTURED");
  });

  it("allows further captures after a non-final partial capture", () => {
    const { auth } = authorize("100.00");
    call({ method: "POST", path: capturePath(auth.id), body: { amount: usd("30.00") } });
    const mid = call({ method: "GET", path: `/v2/payments/authorizations/${auth.id}` });
    expect(mid.body.status).toBe("PARTIALLY_CAPTURED");
    const over = call({ method: "POST", path: capturePath(auth.id), body: { amount: usd("70.01") } });
    expect(issueOf(over.body)).toBe("MAX_CAPTURE_AMOUNT_EXCEEDED");
    const rest = call({ method: "POST", path: capturePath(auth.id), body: { final_capture: true } });
    expect(rest.body.amount).toEqual(usd("70.00"));
  });

  it("rejects a duplicate invoice id and a currency mismatch", () => {
    const first = authorize("50.00", "job-a");
    const second = authorize("50.00", "job-b");
    call({ method: "POST", path: capturePath(first.auth.id), body: { final_capture: true, invoice_id: "inv" } });
    const dup = call({
      method: "POST",
      path: capturePath(second.auth.id),
      body: { final_capture: true, invoice_id: "inv" },
    });
    expect(issueOf(dup.body)).toBe("DUPLICATE_INVOICE_ID");
    const eur = call({
      method: "POST",
      path: capturePath(second.auth.id),
      body: { amount: { currency_code: "EUR", value: "1.00" }, final_capture: true },
    });
    expect(issueOf(eur.body)).toBe("CURRENCY_MISMATCH");
  });

  it("voids with 204, or 200 and a body when Prefer asks for it", () => {
    const a = authorize("10.00", "job-a");
    const bare = mockPayPalFetch({ method: "POST", path: voidPath(a.auth.id) });
    expect(bare.status).toBe(204);
    expect(bare.body).toBeUndefined();

    const b = authorize("10.00", "job-b");
    const full = call({ method: "POST", path: voidPath(b.auth.id), prefer: "return=representation" });
    expect(full.status).toBe(200);
    expect(full.body.status).toBe("VOIDED");
  });

  it("rejects void after capture, capture after void and a second void", () => {
    const captured = authorize("10.00", "job-a");
    call({ method: "POST", path: capturePath(captured.auth.id), body: { final_capture: true } });
    const voidCaptured = call({ method: "POST", path: voidPath(captured.auth.id) });
    expect(voidCaptured.status).toBe(422);
    expect(issueOf(voidCaptured.body)).toBe("CANNOT_BE_VOIDED");

    const voided = authorize("10.00", "job-b");
    call({ method: "POST", path: voidPath(voided.auth.id) });
    const captureVoided = call({ method: "POST", path: capturePath(voided.auth.id), body: { final_capture: true } });
    expect(issueOf(captureVoided.body)).toBe("AUTHORIZATION_VOIDED");
    const again = call({ method: "POST", path: voidPath(voided.auth.id) });
    expect(issueOf(again.body)).toBe("PREVIOUSLY_VOIDED");
  });

  it("replays the stored response for the same PayPal-Request-Id", () => {
    const { auth } = authorize("100.00");
    const req: MockRequest = {
      method: "POST",
      path: capturePath(auth.id),
      requestId: "same-id",
      body: { amount: usd("80.00"), final_capture: true },
    };
    const first = call(req);
    const replay = call(req);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    const other = call({ ...req, requestId: "other-id" });
    expect(issueOf(other.body)).toBe("AUTHORIZATION_ALREADY_CAPTURED");
  });

  it("refunds a capture fully or partially, never above what is left", () => {
    const { auth } = authorize("100.00");
    const capture = call({ method: "POST", path: capturePath(auth.id), body: { final_capture: true } });
    const refundPath = `/v2/payments/captures/${capture.body.id as string}/refund`;
    const partial = call({ method: "POST", path: refundPath, body: { amount: usd("30.00") } });
    expect(partial.status).toBe(201);
    expect(partial.body).toMatchObject({ status: "COMPLETED", amount: usd("30.00") });
    const over = call({ method: "POST", path: refundPath, body: { amount: usd("70.01") } });
    expect(issueOf(over.body)).toBe("REFUND_AMOUNT_EXCEEDED");
    const rest = call({ method: "POST", path: refundPath, body: {} });
    expect(rest.body.amount).toEqual(usd("70.00"));
    const none = call({ method: "POST", path: refundPath, body: {} });
    expect(issueOf(none.body)).toBe("CAPTURE_FULLY_REFUNDED");
  });

  it("reauthorizes into a new authorization id and retires the old one", () => {
    const { auth, orderId } = authorize("100.00");
    const next = call({ method: "POST", path: `/v2/payments/authorizations/${auth.id}/reauthorize` });
    expect(next.status).toBe(201);
    expect(next.body.id).not.toBe(auth.id);
    expect(next.body.status).toBe("CREATED");
    const old = call({ method: "POST", path: capturePath(auth.id), body: { final_capture: true } });
    expect(issueOf(old.body)).toBe("AUTHORIZATION_VOIDED");
    const fresh = call({ method: "POST", path: capturePath(next.body.id as string), body: { final_capture: true } });
    expect(fresh.status).toBe(201);
    const order = call({ method: "GET", path: `/v2/checkout/orders/${orderId}` });
    const unit = (order.body.purchase_units as Array<{ payments: { authorizations: unknown[] } }>)[0];
    expect(unit?.payments.authorizations).toHaveLength(2);
  });

  it("returns 404 for unknown ids and routes", () => {
    expect(call({ method: "GET", path: "/v2/checkout/orders/NOPE" }).status).toBe(404);
    expect(call({ method: "POST", path: capturePath("NOPE") }).status).toBe(404);
    const unknown = call({ method: "GET", path: "/v1/unknown" });
    expect(unknown.status).toBe(404);
    expect(issueOf(unknown.body)).toBe("MOCK_ROUTE_NOT_IMPLEMENTED");
  });
});
