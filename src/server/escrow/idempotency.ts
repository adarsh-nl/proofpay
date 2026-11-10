import { createHash } from "node:crypto";
import { getDb, type ProofPayDb } from "@/server/db/client";
import {
  getPaypalIdempotency,
  savePaypalIdempotency,
} from "@/server/db/repo";

/**
 * PayPal request ids and replay protection (AGENTS.md §8, MANUAL §10.2).
 *
 * The same `(jobId, op, attempt)` must always produce the same
 * `PayPal-Request-Id`, and a replayed id must return the stored response
 * instead of moving money twice.
 */

/** Deterministic `PayPal-Request-Id`: sha256(`${jobId}:${op}:${attempt}`). */
export function paypalRequestId(
  jobId: string,
  op: string,
  attempt = 1,
): string {
  return createHash("sha256").update(`${jobId}:${op}:${attempt}`).digest("hex");
}

export interface IdempotencyOptions {
  jobId: string;
  /** Operation name, e.g. `capture`, `void`, `refund`, `reauthorize`. */
  op: string;
  /** Retry counter for the same logical operation (default 1). */
  attempt?: number;
  db?: ProofPayDb;
}

export interface IdempotentResult<T> {
  data: T;
  requestId: string;
  /** True when the stored response was returned and `run` was not executed. */
  replayed: boolean;
}

export function idempotencyKey(
  jobId: string,
  op: string,
  attempt = 1,
): string {
  return `${jobId}:${op}:${attempt}`;
}

/**
 * Run a PayPal write operation at most once per `(jobId, op, attempt)`.
 * The first successful response is persisted in `paypal_idempotency`; replays
 * return it without calling PayPal again. Failures are not persisted, so a
 * failed attempt can be retried safely with the same request id.
 */
export async function withPaypalIdempotency<T>(
  options: IdempotencyOptions,
  run: (requestId: string) => Promise<T>,
): Promise<IdempotentResult<T>> {
  const key = idempotencyKey(options.jobId, options.op, options.attempt);
  const db = options.db ?? getDb();
  const requestId = paypalRequestId(options.jobId, options.op, options.attempt);

  const stored = getPaypalIdempotency(key, db);
  if (stored?.responseJson) {
    try {
      const replay = JSON.parse(stored.responseJson) as T;
      console.info(`[idempotency] replay ${key} requestId=${stored.requestId}`);
      return { data: replay, requestId: stored.requestId, replayed: true };
    } catch {
      // Corrupt row: fall through and execute the call again.
      console.warn(`[idempotency] unreadable stored response for ${key}; re-running`);
    }
  }

  const data = await run(requestId);
  savePaypalIdempotency(key, requestId, data, db);
  return { data, requestId, replayed: false };
}
