import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resetEnvCache } from "@/server/env";
import {
  getAccessToken,
  ppFetch,
  ppFetchWithMeta,
  resetTokenCache,
  tokenExpiresInSeconds,
} from "@/server/paypal/client";
import { PayPalError, PayPalNetworkError } from "@/server/paypal/errors";

const BASE = "https://api-m.sandbox.paypal.com";

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
let queue: Array<() => Response | Promise<Response>> = [];

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const token = (value = "tok-1", expiresIn = 3600) =>
  json(200, { access_token: value, expires_in: expiresIn });
const header = (call: Call | undefined, name: string) =>
  new Headers(call?.init.headers).get(name);

beforeEach(() => {
  calls.length = 0;
  queue = [];
  vi.stubEnv("PAYPAL_MOCK", "0");
  vi.stubEnv("PAYPAL_CLIENT_ID", "client-id");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "client-secret");
  resetEnvCache();
  resetTokenCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const next = queue.shift();
      if (!next) throw new Error(`unexpected fetch ${String(url)}`);
      return next();
    }),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetEnvCache();
  resetTokenCache();
});

describe("getAccessToken", () => {
  it("requests a client-credentials token with Basic auth", async () => {
    queue.push(() => token());
    await expect(getAccessToken()).resolves.toBe("tok-1");
    expect(calls[0]?.url).toBe(`${BASE}/v1/oauth2/token`);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe("grant_type=client_credentials");
    expect(header(calls[0], "authorization")).toBe(
      `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
    );
    expect(tokenExpiresInSeconds()).toBeGreaterThan(3590);
  });

  it("caches the token until expires_in - 60s", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    queue.push(() => token("tok-1", 3600), () => token("tok-2", 3600));

    await getAccessToken();
    vi.setSystemTime(new Date("2026-11-10T12:58:59Z")); // 3539s later: still valid
    await expect(getAccessToken()).resolves.toBe("tok-1");
    expect(calls).toHaveLength(1);

    vi.setSystemTime(new Date("2026-11-10T12:59:01Z")); // inside the 60s safety window
    await expect(getAccessToken()).resolves.toBe("tok-2");
    expect(calls).toHaveLength(2);
  });

  it("shares one in-flight token request", async () => {
    queue.push(() => token());
    const [a, b] = await Promise.all([getAccessToken(), getAccessToken()]);
    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
  });

  it("maps an OAuth failure to PayPalError", async () => {
    queue.push(() =>
      json(401, { error: "invalid_client", error_description: "Client Authentication failed" }),
    );
    await expect(getAccessToken()).rejects.toMatchObject({
      name: "PayPalError",
      status: 401,
      issue: "invalid_client",
    });
  });
});

describe("ppFetch", () => {
  it("sets Bearer, Prefer and PayPal-Request-Id on writes and returns the body", async () => {
    queue.push(() => token(), () => json(201, { id: "ORDER-1" }, { "paypal-debug-id": "dbg-1" }));
    const result = await ppFetchWithMeta("/v2/checkout/orders", {
      method: "POST",
      body: { intent: "AUTHORIZE" },
      idempotencyKey: "req-1",
      schema: z.object({ id: z.string() }),
    });
    expect(result).toEqual({ data: { id: "ORDER-1" }, status: 201, debugId: "dbg-1" });
    const call = calls[1];
    expect(call?.url).toBe(`${BASE}/v2/checkout/orders`);
    expect(header(call, "authorization")).toBe("Bearer tok-1");
    expect(header(call, "prefer")).toBe("return=representation");
    expect(header(call, "paypal-request-id")).toBe("req-1");
    expect(header(call, "content-type")).toBe("application/json");
    expect(call?.init.body).toBe(JSON.stringify({ intent: "AUTHORIZE" }));
  });

  it("omits Prefer and PayPal-Request-Id on a plain GET", async () => {
    queue.push(() => token(), () => json(200, { id: "A" }));
    await ppFetch("/v2/payments/authorizations/A");
    expect(header(calls[1], "prefer")).toBeNull();
    expect(header(calls[1], "paypal-request-id")).toBeNull();
    expect(calls[1]?.init.method).toBe("GET");
  });

  it("returns undefined for 204 No Content (void)", async () => {
    queue.push(() => token(), () => new Response(null, { status: 204 }));
    const data = await ppFetch("/v2/payments/authorizations/A/void", {
      method: "POST",
      idempotencyKey: "req-void",
      schema: z.object({ id: z.string() }),
    });
    expect(data).toBeUndefined();
  });

  it("maps a 422 body to PayPalError(status, issue, debugId)", async () => {
    queue.push(
      () => token(),
      () =>
        json(422, {
          name: "UNPROCESSABLE_ENTITY",
          message: "The requested action could not be performed.",
          debug_id: "dbg-422",
          details: [{ issue: "MAX_CAPTURE_AMOUNT_EXCEEDED", description: "Too much." }],
        }),
    );
    const error = await ppFetch("/v2/payments/authorizations/A/capture", {
      method: "POST",
      idempotencyKey: "req-cap",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({
      status: 422,
      issue: "MAX_CAPTURE_AMOUNT_EXCEEDED",
      debugId: "dbg-422",
      paypalName: "UNPROCESSABLE_ENTITY",
      description: "Too much.",
    });
    expect(calls).toHaveLength(2); // 4xx is never retried
  });

  it("falls back to the paypal-debug-id header and the error name", async () => {
    queue.push(
      () => token(),
      () => json(404, { name: "RESOURCE_NOT_FOUND" }, { "paypal-debug-id": "dbg-h" }),
    );
    await expect(ppFetch("/v2/checkout/orders/nope")).rejects.toMatchObject({
      status: 404,
      issue: "RESOURCE_NOT_FOUND",
      debugId: "dbg-h",
    });
  });

  it("rejects a response that fails the schema", async () => {
    queue.push(() => token(), () => json(200, { id: 42 }));
    await expect(
      ppFetch("/v2/checkout/orders/X", { schema: z.object({ id: z.string() }) }),
    ).rejects.toThrow();
  });

  it("retries a write that carries a request id (500 ms, then 1500 ms)", async () => {
    vi.useFakeTimers();
    queue.push(
      () => token(),
      () => Promise.reject(new TypeError("fetch failed")),
      () => json(503, { name: "SERVICE_UNAVAILABLE" }),
      () => json(201, { id: "CAP-1" }),
    );
    const pending = ppFetch("/v2/payments/authorizations/A/capture", {
      method: "POST",
      idempotencyKey: "req-retry",
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(pending).resolves.toEqual({ id: "CAP-1" });
    expect(calls).toHaveLength(4);
    expect(calls.slice(1).every((c) => header(c, "paypal-request-id") === "req-retry")).toBe(true);
  });

  it("gives up after two retries", async () => {
    vi.useFakeTimers();
    queue.push(
      () => token(),
      () => json(503, {}),
      () => json(503, {}),
      () => json(503, { name: "SERVICE_UNAVAILABLE" }),
    );
    const pending = ppFetch("/v2/payments/authorizations/A/capture", {
      method: "POST",
      idempotencyKey: "req-retry",
    }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toMatchObject({ status: 503, issue: "SERVICE_UNAVAILABLE" });
    expect(calls).toHaveLength(4);
  });

  it("never retries a write without a request id", async () => {
    queue.push(() => token(), () => Promise.reject(new TypeError("fetch failed")));
    await expect(
      ppFetch("/v2/checkout/orders", { method: "POST", body: {} }),
    ).rejects.toBeInstanceOf(PayPalNetworkError);
    expect(calls).toHaveLength(2);
  });

  it("drops the cached token after a 401", async () => {
    queue.push(() => token("tok-1"), () => json(401, { error: "invalid_token" }), () => token("tok-2"));
    await expect(ppFetch("/v2/checkout/orders/X")).rejects.toMatchObject({ status: 401 });
    await expect(getAccessToken()).resolves.toBe("tok-2");
  });

  it("serves calls from the mock without any network when PAYPAL_MOCK=1", async () => {
    vi.stubEnv("PAYPAL_MOCK", "1");
    resetEnvCache();
    const order = await ppFetch("/v2/checkout/orders", {
      method: "POST",
      idempotencyKey: "job:create:1",
      body: {
        intent: "AUTHORIZE",
        purchase_units: [{ custom_id: "job", amount: { currency_code: "USD", value: "60.00" } }],
      },
      schema: z.object({ id: z.string(), status: z.string() }),
    });
    expect(order.id).toMatch(/^MOCK-ORDER-\d+$/);
    expect(calls).toHaveLength(0);
  });
});
