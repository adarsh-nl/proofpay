import "server-only";
import type { z } from "zod";
import { getEnv } from "@/server/env";
import { PayPalError, PayPalNetworkError, type PayPalErrorDetail } from "./errors";
import { mockPayPalFetch } from "./mock";

/**
 * Typed PayPal REST wrapper (docs/MANUAL.md §10.2). Every PayPal call in the
 * app goes through `ppFetch`. With `PAYPAL_MOCK=1` calls are served by the
 * in-memory fake in `./mock` and no token is fetched.
 */

export type PpFetchOptions<T> = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Sent as `PayPal-Request-Id`. Required on every POST that moves money. */
  idempotencyKey?: string;
  /** `Prefer` header; defaults to `return=representation` on writes. */
  prefer?: string;
  /** Validates the response body. Skipped for 204 responses. */
  schema?: z.ZodType<T>;
};

export type PpResult<T> = { data: T; status: number; debugId: string | undefined };

const TOKEN_SAFETY_MS = 60_000;
/** Backoff before retry 1 and retry 2 (docs/MANUAL.md §13). */
export const RETRY_DELAYS_MS = [500, 1500] as const;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

let tokenCache: { token: string; expiresAt: number } | undefined;
let tokenInFlight: Promise<string> | undefined;

/** Tests only. */
export function resetTokenCache(): void {
  tokenCache = undefined;
  tokenInFlight = undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Map a PayPal error body `{name, message, details[{issue, description}], debug_id}`. */
export function toPayPalError(
  status: number,
  body: unknown,
  headerDebugId: string | undefined,
): PayPalError {
  const record = isRecord(body) ? body : {};
  const details: PayPalErrorDetail[] = Array.isArray(record.details)
    ? record.details.filter(isRecord).map((detail) => ({
        issue: typeof detail.issue === "string" ? detail.issue : undefined,
        description: typeof detail.description === "string" ? detail.description : undefined,
        field: typeof detail.field === "string" ? detail.field : undefined,
      }))
    : [];
  // OAuth errors use `{error, error_description}` instead.
  const name =
    typeof record.name === "string"
      ? record.name
      : typeof record.error === "string"
        ? record.error
        : `HTTP_${status}`;
  const message =
    typeof record.message === "string"
      ? record.message
      : typeof record.error_description === "string"
        ? record.error_description
        : undefined;
  const debugId = typeof record.debug_id === "string" ? record.debug_id : headerDebugId;
  return new PayPalError(status, details[0]?.issue ?? name, debugId, {
    name,
    message,
    description: details[0]?.description,
    details,
  });
}

async function fetchToken(): Promise<string> {
  const env = getEnv();
  const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString(
    "base64",
  );
  let res: Response;
  try {
    res = await fetch(`${env.PAYPAL_API_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
  } catch (cause) {
    throw new PayPalNetworkError("Could not reach PayPal to get an access token", { cause });
  }
  const body = await readJson(res);
  if (!res.ok) {
    throw toPayPalError(res.status, body, res.headers.get("paypal-debug-id") ?? undefined);
  }
  if (
    !isRecord(body) ||
    typeof body.access_token !== "string" ||
    typeof body.expires_in !== "number"
  ) {
    throw new PayPalError(res.status, "INVALID_TOKEN_RESPONSE", undefined);
  }
  tokenCache = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

/** Seconds until the cached token expires (0 when none). Never exposes the token. */
export function tokenExpiresInSeconds(): number {
  return tokenCache ? Math.max(0, Math.round((tokenCache.expiresAt - Date.now()) / 1000)) : 0;
}

/** OAuth2 client-credentials token, cached until `expires_in - 60s`. */
export async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - TOKEN_SAFETY_MS) {
    return tokenCache.token;
  }
  tokenInFlight ??= fetchToken().finally(() => {
    tokenInFlight = undefined;
  });
  return tokenInFlight;
}

type RawResponse = { status: number; body: unknown; debugId: string | undefined };

async function send(
  path: string,
  method: string,
  options: PpFetchOptions<unknown>,
  prefer: string | undefined,
): Promise<RawResponse> {
  const env = getEnv();
  if (env.PAYPAL_MOCK) {
    return mockPayPalFetch({
      method,
      path,
      body: options.body,
      requestId: options.idempotencyKey,
      prefer,
    });
  }
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (options.idempotencyKey) headers["PayPal-Request-Id"] = options.idempotencyKey;
  if (prefer) headers.Prefer = prefer;
  let res: Response;
  try {
    res = await fetch(`${env.PAYPAL_API_BASE}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (cause) {
    throw new PayPalNetworkError(`Could not reach PayPal (${method} ${path})`, { cause });
  }
  if (res.status === 401) resetTokenCache();
  return {
    status: res.status,
    body: res.status === 204 ? undefined : await readJson(res),
    debugId: res.headers.get("paypal-debug-id") ?? undefined,
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Call the PayPal REST API and return the body with status and debug id.
 * Retries (max 2, 500 ms then 1500 ms) only when the call is safe to repeat:
 * GETs, and writes that carry a `PayPal-Request-Id`.
 */
export async function ppFetchWithMeta<T = unknown>(
  path: string,
  options: PpFetchOptions<T> = {},
): Promise<PpResult<T>> {
  if (!path.startsWith("/")) throw new Error(`PayPal path must start with "/": ${path}`);
  const method = options.method ?? "GET";
  const prefer = options.prefer ?? (method === "GET" ? undefined : "return=representation");
  const retryable = method === "GET" || Boolean(options.idempotencyKey);

  for (let attempt = 0; ; attempt += 1) {
    const delay = retryable ? RETRY_DELAYS_MS[attempt] : undefined;
    let raw: RawResponse;
    try {
      raw = await send(path, method, options, prefer);
    } catch (error) {
      if (error instanceof PayPalNetworkError && delay !== undefined) {
        console.warn(`[paypal] network error on ${method} ${path}; retry ${attempt + 1}`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
    if (raw.status >= 200 && raw.status < 300) {
      const data =
        raw.status === 204 || !options.schema
          ? (raw.body as T)
          : options.schema.parse(raw.body);
      return { data, status: raw.status, debugId: raw.debugId };
    }
    if (RETRYABLE_STATUS.has(raw.status) && delay !== undefined) {
      console.warn(`[paypal] ${raw.status} on ${method} ${path}; retry ${attempt + 1}`);
      await sleep(delay);
      continue;
    }
    throw toPayPalError(raw.status, raw.body, raw.debugId);
  }
}

/** Call the PayPal REST API and return the parsed body (`undefined` for 204). */
export async function ppFetch<T = unknown>(
  path: string,
  options: PpFetchOptions<T> = {},
): Promise<T> {
  return (await ppFetchWithMeta(path, options)).data;
}
