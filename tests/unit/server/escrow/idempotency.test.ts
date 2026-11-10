import { beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  runMigrations,
  type ProofPayDb,
} from "@/server/db/client";
import { getPaypalIdempotency } from "@/server/db/repo";
import {
  idempotencyKey,
  paypalRequestId,
  withPaypalIdempotency,
} from "@/server/escrow/idempotency";

let db: ProofPayDb;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

describe("paypalRequestId", () => {
  it("is the deterministic sha256 of jobId:op:attempt", () => {
    const requestId = paypalRequestId("demo-bike", "capture", 1);
    expect(requestId).toMatch(/^[0-9a-f]{64}$/);
    expect(paypalRequestId("demo-bike", "capture", 1)).toBe(requestId);
    expect(paypalRequestId("demo-bike", "capture", 2)).not.toBe(requestId);
    expect(paypalRequestId("demo-bike", "void", 1)).not.toBe(requestId);
    expect(paypalRequestId("demo-cleaning", "capture", 1)).not.toBe(requestId);
  });

  it("defaults attempt to 1", () => {
    expect(paypalRequestId("job", "capture")).toBe(
      paypalRequestId("job", "capture", 1),
    );
  });

  it("builds the key as jobId:op:attempt", () => {
    expect(idempotencyKey("job", "refund", 3)).toBe("job:refund:3");
  });
});

describe("withPaypalIdempotency", () => {
  it("runs once and persists the response and request id", async () => {
    let calls = 0;
    const run = async (requestId: string) => {
      calls += 1;
      return { captureId: `MOCK-CAP-${calls}`, requestId };
    };

    const first = await withPaypalIdempotency(
      { jobId: "job-1", op: "capture", db },
      run,
    );
    expect(first.replayed).toBe(false);
    expect(first.requestId).toBe(paypalRequestId("job-1", "capture", 1));
    expect(first.data.captureId).toBe("MOCK-CAP-1");

    const row = getPaypalIdempotency("job-1:capture:1", db);
    expect(row?.requestId).toBe(first.requestId);
    expect(row?.responseJson).toContain("MOCK-CAP-1");

    const second = await withPaypalIdempotency(
      { jobId: "job-1", op: "capture", db },
      run,
    );
    expect(second.replayed).toBe(true);
    expect(second.data).toEqual(first.data);
    expect(second.requestId).toBe(first.requestId);
    expect(calls).toBe(1);
  });

  it("uses a different request id and row per attempt", async () => {
    const first = await withPaypalIdempotency(
      { jobId: "job-1", op: "capture", attempt: 1, db },
      async () => ({ attempt: 1 }),
    );
    const second = await withPaypalIdempotency(
      { jobId: "job-1", op: "capture", attempt: 2, db },
      async () => ({ attempt: 2 }),
    );
    expect(first.requestId).not.toBe(second.requestId);
    expect(second.replayed).toBe(false);
    expect(getPaypalIdempotency("job-1:capture:2", db)?.requestId).toBe(
      second.requestId,
    );
  });

  it("does not cache failures, so a retry can run again", async () => {
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw new Error("network down");
    };
    await expect(
      withPaypalIdempotency({ jobId: "job-2", op: "capture", db }, failing),
    ).rejects.toThrow("network down");
    expect(getPaypalIdempotency("job-2:capture:1", db)).toBeNull();

    const recovered = await withPaypalIdempotency(
      { jobId: "job-2", op: "capture", db },
      async () => {
        calls += 1;
        return { ok: true };
      },
    );
    expect(recovered.replayed).toBe(false);
    expect(calls).toBe(2);
  });
});
