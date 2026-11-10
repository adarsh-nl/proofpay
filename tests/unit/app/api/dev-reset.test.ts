import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as reset } from "@/app/api/dev/reset/route";
import { getJob, insertEvidence, listEvidence, listJobs } from "@/server/db/repo";
import { seedDemoJobs } from "@/server/db/seed";
import { transition } from "@/server/escrow/machine";
import { mockPayPalFetch } from "@/server/paypal/mock";
import { authorizeOrder, createOrder } from "@/server/paypal/orders";
import type { JobListItem } from "@/shared/contracts";
import { apiRequest, jsonOf, makeJob, params, setupTestApp, teardownTestApp } from "../../helpers";

const none = params({});
let uploadDir: string;

function start(env: Record<string, string> = {}): void {
  setupTestApp({ UPLOAD_DIR: uploadDir, DEMO_RESET_ENABLED: "1", ...env });
}

beforeEach(() => {
  uploadDir = mkdtempSync(path.join(tmpdir(), "pp-reset-"));
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  teardownTestApp();
  vi.restoreAllMocks();
  rmSync(uploadDir, { recursive: true, force: true });
});

const post = (role?: "customer" | "worker" | "reviewer", headers?: Record<string, string>) =>
  reset(apiRequest("/api/dev/reset", { method: "POST", role, headers }), none);

describe("POST /api/dev/reset", () => {
  it("answers 404 unless DEMO_RESET_ENABLED=1, whatever the role", async () => {
    start({ DEMO_RESET_ENABLED: "0" });
    seedDemoJobs();
    const extra = makeJob();
    for (const role of ["reviewer", "customer", undefined] as const) {
      expect((await post(role)).status).toBe(404);
    }
    expect(getJob(extra.id)).not.toBeNull();
  });

  it("is off by default", async () => {
    setupTestApp({ UPLOAD_DIR: uploadDir });
    expect((await post("reviewer")).status).toBe(404);
  });

  it("is reviewer-only", async () => {
    start();
    const extra = makeJob();
    for (const role of ["customer", "worker", undefined] as const) {
      expect((await post(role)).status).toBe(403);
    }
    expect(getJob(extra.id)).not.toBeNull();
  });

  it("needs the reviewer passcode when one is configured", async () => {
    start({ REVIEWER_PASSCODE: "open-sesame" });
    expect((await post("reviewer")).status).toBe(403);
    expect((await post("reviewer", { "x-reviewer-passcode": "open-sesame" })).status).toBe(200);
  });

  it("deletes every job, payment, event and photo and re-seeds the three demo jobs in CREATED", async () => {
    start();
    seedDemoJobs();
    const { orderId } = await createOrder("demo-bike");
    await authorizeOrder(orderId, "demo-bike");
    transition("demo-bike", "EVIDENCE_SUBMITTED", "worker");
    mkdirSync(path.join(uploadDir, "demo-bike"), { recursive: true });
    writeFileSync(path.join(uploadDir, "demo-bike", "after_1.jpg"), "x");
    insertEvidence({
      jobId: "demo-bike",
      phase: "after",
      path: "demo-bike/after_1.jpg",
      mime: "image/jpeg",
      width: 1,
      height: 1,
      sha256: "a".repeat(64),
      dhash: "0".repeat(16),
    });
    const extra = makeJob({ title: "Not a demo job" });

    const res = await post("reviewer");
    expect(res.status).toBe(200);
    const body = await jsonOf<{ jobs: JobListItem[]; deletedJobs: number; releasedHolds: number }>(res);
    expect(body.deletedJobs).toBe(4);
    expect(body.jobs.map((job) => job.id).sort()).toEqual(["demo-bike", "demo-cleaning", "demo-delivery"]);
    expect(body.jobs.every((job) => job.status === "CREATED")).toBe(true);

    expect(getJob(extra.id)).toBeNull();
    const bike = getJob("demo-bike");
    expect(bike?.status).toBe("CREATED");
    expect(bike?.payment).toBeUndefined();
    expect(bike?.livenessCode).toBeUndefined();
    expect(bike?.events.map((event) => event.toStatus)).toEqual(["CREATED"]);
    expect(bike?.criteria.at(-1)?.label).toContain("{CODE}");
    expect(listEvidence()).toEqual([]);
    expect(listJobs()).toHaveLength(3);
    expect(existsSync(uploadDir)).toBe(true);
    expect(readdirSync(uploadDir)).toEqual([]);
  });

  it("clears the PayPal mock so a reset job can be paid for again", async () => {
    start();
    seedDemoJobs();
    const first = await createOrder("demo-bike");
    await authorizeOrder(first.orderId, "demo-bike");
    await post("reviewer");
    expect(mockPayPalFetch({ method: "GET", path: `/v2/checkout/orders/${first.orderId}` }).status).toBe(404);
    const second = await createOrder("demo-bike");
    const job = await authorizeOrder(second.orderId, "demo-bike");
    expect(job.status).toBe("AUTHORIZED");
  });

  it("can be called twice in a row", async () => {
    start();
    expect((await post("reviewer")).status).toBe(200);
    const again = await post("reviewer");
    expect(again.status).toBe(200);
    expect((await jsonOf<{ deletedJobs: number }>(again)).deletedJobs).toBe(3);
  });
});
