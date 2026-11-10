import "server-only";
import { fromCents, toCents } from "@/shared/money";

/**
 * In-memory fake PayPal used when `PAYPAL_MOCK=1` (no network, no credentials).
 * It serves the Orders v2 / Payments v2 calls ProofPay makes, with the same
 * response shapes the code reads and the rules it depends on:
 * capture <= authorized, one final capture, no void after capture, and
 * idempotent replays of a `PayPal-Request-Id`.
 *
 * Assumptions (real behaviour is a LIVE-VERIFY item, see docs/REFERENCES.md):
 * - a partial capture with `final_capture: true` leaves the authorization `CAPTURED`;
 * - reauthorize returns a new authorization id and retires the old one;
 * - the mock skips buyer approval, so authorize works on a `CREATED` order.
 */

export type MockRequest = {
  method: string;
  path: string;
  body?: unknown;
  requestId?: string;
  prefer?: string;
};

export type MockResponse = { status: number; body: unknown; debugId: string };

type Amount = { currency_code: string; value: string };

type MockCapture = {
  id: string;
  authorizationId: string;
  amountCents: number;
  currency: string;
  finalCapture: boolean;
  invoiceId?: string;
  refundedCents: number;
  createTime: string;
};

type MockAuthorization = {
  id: string;
  orderId: string;
  status: "CREATED" | "PARTIALLY_CAPTURED" | "CAPTURED" | "VOIDED";
  amountCents: number;
  currency: string;
  capturedCents: number;
  createTime: string;
  expirationTime: string;
};

type MockOrder = {
  id: string;
  status: "CREATED" | "COMPLETED";
  intent: string;
  purchaseUnit: Record<string, unknown> & { amount: Amount };
  authorizationIds: string[];
  createTime: string;
};

type MockState = {
  seq: number;
  orders: Map<string, MockOrder>;
  authorizations: Map<string, MockAuthorization>;
  captures: Map<string, MockCapture>;
  invoiceIds: Set<string>;
  replays: Map<string, { status: number; body: unknown }>;
};

const STATE_KEY = Symbol.for("proofpay.paypal.mock");
const AUTH_VALID_MS = 29 * 24 * 60 * 60 * 1000;

function freshState(): MockState {
  return {
    seq: 0,
    orders: new Map(),
    authorizations: new Map(),
    captures: new Map(),
    invoiceIds: new Set(),
    replays: new Map(),
  };
}

/** State lives on `globalThis` so it survives Next.js dev hot reloads. */
function state(): MockState {
  const holder = globalThis as unknown as Record<symbol, MockState | undefined>;
  holder[STATE_KEY] ??= freshState();
  return holder[STATE_KEY];
}

/** Tests only. */
export function resetPayPalMock(): void {
  (globalThis as unknown as Record<symbol, MockState | undefined>)[STATE_KEY] =
    freshState();
}

class MockHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly paypalName: string,
    public readonly issue: string,
    public readonly description: string,
  ) {
    super(description);
  }
}

const unprocessable = (issue: string, description: string) =>
  new MockHttpError(422, "UNPROCESSABLE_ENTITY", issue, description);
const notFound = (what: string) =>
  new MockHttpError(
    404,
    "RESOURCE_NOT_FOUND",
    "INVALID_RESOURCE_ID",
    `The specified ${what} does not exist.`,
  );
const invalid = (description: string) =>
  new MockHttpError(400, "INVALID_REQUEST", "INVALID_PARAMETER_SYNTAX", description);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAmount(value: unknown): { cents: number; currency: string } | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    !isRecord(value) ||
    typeof value.currency_code !== "string" ||
    typeof value.value !== "string"
  ) {
    throw invalid("amount must be { currency_code, value }");
  }
  try {
    return { cents: toCents(value.value), currency: value.currency_code };
  } catch {
    throw invalid("amount.value must be a decimal string");
  }
}

const amountOf = (cents: number, currency: string): Amount => ({
  currency_code: currency,
  value: fromCents(cents),
});

function authorizationBody(auth: MockAuthorization) {
  return {
    id: auth.id,
    status: auth.status,
    amount: amountOf(auth.amountCents, auth.currency),
    create_time: auth.createTime,
    expiration_time: auth.expirationTime,
    links: [],
  };
}

function captureBody(capture: MockCapture) {
  return {
    id: capture.id,
    status: "COMPLETED",
    amount: amountOf(capture.amountCents, capture.currency),
    final_capture: capture.finalCapture,
    ...(capture.invoiceId ? { invoice_id: capture.invoiceId } : {}),
    create_time: capture.createTime,
    links: [],
  };
}

function orderBody(order: MockOrder) {
  const s = state();
  const authorizations = order.authorizationIds
    .map((id) => s.authorizations.get(id))
    .filter((auth): auth is MockAuthorization => auth !== undefined)
    .map(authorizationBody);
  return {
    id: order.id,
    status: order.status,
    intent: order.intent,
    create_time: order.createTime,
    purchase_units: [
      {
        ...order.purchaseUnit,
        ...(authorizations.length > 0 ? { payments: { authorizations } } : {}),
      },
    ],
    links: [],
  };
}

function nextId(prefix: string): string {
  const s = state();
  s.seq += 1;
  return `${prefix}-${s.seq}`;
}

function createOrder(body: unknown): { status: number; body: unknown } {
  if (!isRecord(body) || body.intent !== "AUTHORIZE") {
    throw invalid('intent must be "AUTHORIZE"');
  }
  const units = body.purchase_units;
  const unit: unknown = Array.isArray(units) ? units[0] : undefined;
  if (!isRecord(unit)) throw invalid("purchase_units[0] is required");
  const amount = readAmount(unit.amount);
  if (!amount || amount.cents <= 0) throw invalid("purchase_units[0].amount is required");
  const order: MockOrder = {
    id: nextId("MOCK-ORDER"),
    status: "CREATED",
    intent: "AUTHORIZE",
    purchaseUnit: { ...unit, amount: amountOf(amount.cents, amount.currency) },
    authorizationIds: [],
    createTime: new Date().toISOString(),
  };
  state().orders.set(order.id, order);
  return { status: 201, body: orderBody(order) };
}

function authorizeOrder(orderId: string): { status: number; body: unknown } {
  const order = state().orders.get(orderId);
  if (!order) throw notFound("order");
  if (order.authorizationIds.length > 0) {
    throw unprocessable("ORDER_ALREADY_AUTHORIZED", "Order already authorized.");
  }
  const amount = readAmount(order.purchaseUnit.amount);
  if (!amount) throw invalid("order has no amount");
  const now = Date.now();
  const auth: MockAuthorization = {
    id: nextId("MOCK-AUTH"),
    orderId,
    status: "CREATED",
    amountCents: amount.cents,
    currency: amount.currency,
    capturedCents: 0,
    createTime: new Date(now).toISOString(),
    expirationTime: new Date(now + AUTH_VALID_MS).toISOString(),
  };
  state().authorizations.set(auth.id, auth);
  order.authorizationIds.push(auth.id);
  order.status = "COMPLETED";
  return { status: 201, body: orderBody(order) };
}

function requireAuthorization(id: string): MockAuthorization {
  const auth = state().authorizations.get(id);
  if (!auth) throw notFound("authorization");
  return auth;
}

function captureAuthorization(id: string, body: unknown): { status: number; body: unknown } {
  const auth = requireAuthorization(id);
  if (auth.status === "VOIDED") {
    throw unprocessable("AUTHORIZATION_VOIDED", "A voided authorization cannot be captured.");
  }
  if (auth.status === "CAPTURED") {
    throw unprocessable(
      "AUTHORIZATION_ALREADY_CAPTURED",
      "Authorization has already been captured.",
    );
  }
  const request = isRecord(body) ? body : {};
  const remaining = auth.amountCents - auth.capturedCents;
  const requested = readAmount(request.amount) ?? { cents: remaining, currency: auth.currency };
  if (requested.currency !== auth.currency) {
    throw unprocessable(
      "CURRENCY_MISMATCH",
      "Capture currency must match the authorization currency.",
    );
  }
  if (requested.cents <= 0) throw invalid("amount.value must be greater than zero");
  if (requested.cents > remaining) {
    throw unprocessable(
      "MAX_CAPTURE_AMOUNT_EXCEEDED",
      "Capture amount exceeds the remaining authorized amount.",
    );
  }
  const invoiceId = typeof request.invoice_id === "string" ? request.invoice_id : undefined;
  if (invoiceId && state().invoiceIds.has(invoiceId)) {
    throw unprocessable("DUPLICATE_INVOICE_ID", "Duplicate invoice id detected.");
  }
  const finalCapture = request.final_capture === true;
  const capture: MockCapture = {
    id: nextId("MOCK-CAP"),
    authorizationId: auth.id,
    amountCents: requested.cents,
    currency: auth.currency,
    finalCapture,
    invoiceId,
    refundedCents: 0,
    createTime: new Date().toISOString(),
  };
  state().captures.set(capture.id, capture);
  if (invoiceId) state().invoiceIds.add(invoiceId);
  auth.capturedCents += requested.cents;
  auth.status =
    finalCapture || auth.capturedCents === auth.amountCents ? "CAPTURED" : "PARTIALLY_CAPTURED";
  return { status: 201, body: captureBody(capture) };
}

function voidAuthorization(id: string, prefer?: string): { status: number; body: unknown } {
  const auth = requireAuthorization(id);
  if (auth.status === "VOIDED") {
    throw unprocessable("PREVIOUSLY_VOIDED", "Authorization has been previously voided.");
  }
  if (auth.status === "CAPTURED") {
    throw unprocessable(
      "CANNOT_BE_VOIDED",
      "A fully captured authorization cannot be voided.",
    );
  }
  auth.status = "VOIDED";
  return prefer === "return=representation"
    ? { status: 200, body: authorizationBody(auth) }
    : { status: 204, body: undefined };
}

function reauthorize(id: string, body: unknown): { status: number; body: unknown } {
  const auth = requireAuthorization(id);
  if (auth.status === "VOIDED") {
    throw unprocessable("AUTHORIZATION_VOIDED", "A voided authorization cannot be reauthorized.");
  }
  if (auth.status !== "CREATED") {
    throw unprocessable(
      "AUTHORIZATION_ALREADY_CAPTURED",
      "A captured authorization cannot be reauthorized.",
    );
  }
  const requested = readAmount(isRecord(body) ? body.amount : undefined);
  if (requested && requested.currency !== auth.currency) {
    throw unprocessable("CURRENCY_MISMATCH", "Currency must match the authorization currency.");
  }
  const now = Date.now();
  const next: MockAuthorization = {
    ...auth,
    id: nextId("MOCK-AUTH"),
    amountCents: requested?.cents ?? auth.amountCents,
    createTime: new Date(now).toISOString(),
    expirationTime: new Date(now + AUTH_VALID_MS).toISOString(),
  };
  auth.status = "VOIDED";
  state().authorizations.set(next.id, next);
  state().orders.get(auth.orderId)?.authorizationIds.push(next.id);
  return { status: 201, body: authorizationBody(next) };
}

function refundCapture(id: string, body: unknown): { status: number; body: unknown } {
  const capture = state().captures.get(id);
  if (!capture) throw notFound("capture");
  const remaining = capture.amountCents - capture.refundedCents;
  if (remaining === 0) {
    throw unprocessable("CAPTURE_FULLY_REFUNDED", "The capture has already been fully refunded.");
  }
  const requested = readAmount(isRecord(body) ? body.amount : undefined) ?? {
    cents: remaining,
    currency: capture.currency,
  };
  if (requested.currency !== capture.currency) {
    throw unprocessable("CURRENCY_MISMATCH", "Refund currency must match the capture currency.");
  }
  if (requested.cents <= 0) throw invalid("amount.value must be greater than zero");
  if (requested.cents > remaining) {
    throw unprocessable(
      "REFUND_AMOUNT_EXCEEDED",
      "The refund amount must be less than or equal to the capture amount that has not yet been refunded.",
    );
  }
  capture.refundedCents += requested.cents;
  return {
    status: 201,
    body: {
      id: nextId("MOCK-REFUND"),
      status: "COMPLETED",
      amount: amountOf(requested.cents, capture.currency),
      create_time: new Date().toISOString(),
      links: [],
    },
  };
}

function route(req: MockRequest): { status: number; body: unknown } {
  const method = req.method.toUpperCase();
  const path = req.path.split("?")[0] ?? "";
  let m: RegExpExecArray | null;

  if (method === "POST" && path === "/v2/checkout/orders") return createOrder(req.body);
  if ((m = /^\/v2\/checkout\/orders\/([^/]+)$/.exec(path)) && method === "GET") {
    const order = state().orders.get(m[1] ?? "");
    if (!order) throw notFound("order");
    return { status: 200, body: orderBody(order) };
  }
  if ((m = /^\/v2\/checkout\/orders\/([^/]+)\/authorize$/.exec(path)) && method === "POST") {
    return authorizeOrder(m[1] ?? "");
  }
  if ((m = /^\/v2\/payments\/authorizations\/([^/]+)$/.exec(path)) && method === "GET") {
    return { status: 200, body: authorizationBody(requireAuthorization(m[1] ?? "")) };
  }
  if (
    (m = /^\/v2\/payments\/authorizations\/([^/]+)\/(capture|void|reauthorize)$/.exec(path)) &&
    method === "POST"
  ) {
    const id = m[1] ?? "";
    if (m[2] === "capture") return captureAuthorization(id, req.body);
    if (m[2] === "void") return voidAuthorization(id, req.prefer);
    return reauthorize(id, req.body);
  }
  if ((m = /^\/v2\/payments\/captures\/([^/]+)$/.exec(path)) && method === "GET") {
    const capture = state().captures.get(m[1] ?? "");
    if (!capture) throw notFound("capture");
    return { status: 200, body: captureBody(capture) };
  }
  if ((m = /^\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(path)) && method === "POST") {
    return refundCapture(m[1] ?? "", req.body);
  }
  throw new MockHttpError(
    404,
    "RESOURCE_NOT_FOUND",
    "MOCK_ROUTE_NOT_IMPLEMENTED",
    `PAYPAL_MOCK has no handler for ${method} ${path}`,
  );
}

/** Serve one PayPal REST call from memory. Never throws for PayPal-level errors. */
export function mockPayPalFetch(req: MockRequest): MockResponse {
  const s = state();
  const debugId = `MOCK-DEBUG-${s.seq + 1}`;
  const replayKey = req.requestId ? `${req.method.toUpperCase()} ${req.requestId}` : undefined;
  const replay = replayKey ? s.replays.get(replayKey) : undefined;
  if (replay) return { ...structuredClone(replay), debugId };

  try {
    const result = route(req);
    const response = { status: result.status, body: structuredClone(result.body) };
    if (replayKey) s.replays.set(replayKey, response);
    return { ...structuredClone(response), debugId };
  } catch (error) {
    if (!(error instanceof MockHttpError)) throw error;
    return {
      status: error.status,
      debugId,
      body: {
        name: error.paypalName,
        message: error.description,
        debug_id: debugId,
        details: [{ issue: error.issue, description: error.description }],
      },
    };
  }
}
