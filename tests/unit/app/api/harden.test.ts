import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { POST as evidencePack } from "@/app/api/jobs/[id]/agent/evidence-pack/route";
import { PUT as putCriteria } from "@/app/api/jobs/[id]/criteria/route";
import { DELETE as deleteEvidence } from "@/app/api/jobs/[id]/evidence/[evidenceId]/route";
import { POST as postEvidence } from "@/app/api/jobs/[id]/evidence/route";
import { POST as refund } from "@/app/api/jobs/[id]/refund/route";
import { POST as review } from "@/app/api/jobs/[id]/review/route";
import { GET as getJobRoute } from "@/app/api/jobs/[id]/route";
import { POST as accept } from "@/app/api/jobs/[id]/settlement/accept/route";
import { POST as decline } from "@/app/api/jobs/[id]/settlement/decline/route";
import { POST as submit } from "@/app/api/jobs/[id]/submit/route";
import { POST as verify } from "@/app/api/jobs/[id]/verify/route";
import { POST as voidRoute } from "@/app/api/jobs/[id]/void/route";
import { POST as createJobRoute } from "@/app/api/jobs/route";
import { POST as authorize } from "@/app/api/paypal/orders/[orderId]/authorize/route";
import { POST as createOrderRoute } from "@/app/api/paypal/orders/route";
import { GET as reviewQueue } from "@/app/api/review-queue/route";
import { getJob } from "@/server/db/repo";
import { resetEnvCache } from "@/server/env";
import { MAX_JSON_BYTES, readJson } from "@/server/http/with-errors";
import { getAccessToken, ppFetch, resetTokenCache } from "@/server/paypal/client";
import { authorizeOrder, createOrder } from "@/server/paypal/orders";
import { runVerification } from "@/server/vision/orchestrator";
import type { Job, Role } from "@/shared/contracts";
import { apiRequest, jsonOf, makeJob, params, setupTestApp, teardownTestApp } from "../../helpers";

type ErrorBody = { error: { code: string; message: string } };
type AnyHandler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;
let uploadDir: string;

beforeEach(() => {
  uploadDir = mkdtempSync(path.join(tmpdir(), "pp-harden-"));
  setupTestApp({ UPLOAD_DIR: uploadDir });
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  teardownTestApp();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(uploadDir, { recursive: true, force: true });
});

async function authorizedJob(): Promise<Job> {
  const job = makeJob();
  const { orderId } = await createOrder(job.id);
  return authorizeOrder(orderId, job.id);
}

async function photo(seed: number): Promise<File> {
  const bytes = await sharp({
    create: { width: 80, height: 60, channels: 3, background: { r: seed, g: 90, b: 160 } },
  })
    .jpeg()
    .toBuffer();
  return new File([new Uint8Array(bytes)], `p${seed}.jpg`, { type: "image/jpeg" });
}

describe("role guard on every route that changes or reveals protected data", () => {
  const p = { id: "demo", evidenceId: "e", orderId: "o" } as never;
  const routes: Array<[string, AnyHandler, string, Role[]]> = [
    ["POST /api/jobs", createJobRoute as AnyHandler, "POST", ["customer"]],
    ["PUT /api/jobs/:id/criteria", putCriteria as AnyHandler, "PUT", ["customer"]],
    ["POST /api/paypal/orders", createOrderRoute as AnyHandler, "POST", ["customer"]],
    ["POST /api/paypal/orders/:id/authorize", authorize as AnyHandler, "POST", ["customer"]],
    ["POST /api/jobs/:id/evidence", postEvidence as AnyHandler, "POST", ["worker"]],
    ["DELETE /api/jobs/:id/evidence/:eid", deleteEvidence as AnyHandler, "DELETE", ["worker"]],
    ["POST /api/jobs/:id/submit", submit as AnyHandler, "POST", ["worker"]],
    ["POST /api/jobs/:id/settlement/accept", accept as AnyHandler, "POST", ["customer"]],
    ["POST /api/jobs/:id/settlement/decline", decline as AnyHandler, "POST", ["customer", "worker"]],
    ["POST /api/jobs/:id/void", voidRoute as AnyHandler, "POST", ["customer", "reviewer"]],
    ["POST /api/jobs/:id/review", review as AnyHandler, "POST", ["reviewer"]],
    ["POST /api/jobs/:id/refund", refund as AnyHandler, "POST", ["reviewer"]],
    ["POST /api/jobs/:id/verify", verify as AnyHandler, "POST", ["reviewer"]],
    ["POST /api/jobs/:id/agent/evidence-pack", evidencePack as AnyHandler, "POST", ["reviewer"]],
    ["GET /api/review-queue", reviewQueue as AnyHandler, "GET", ["reviewer"]],
  ];
  const all: Array<Role | undefined> = ["customer", "worker", "reviewer", undefined];

  it.each(routes)("%s answers 403 FORBIDDEN_ROLE to every other role", async (_name, handler, method, allowed) => {
    for (const role of all.filter((r) => !r || !allowed.includes(r))) {
      const res = await handler(apiRequest("/x", { method, role }), { params: Promise.resolve(p) });
      expect(res.status, `role ${role ?? "none"}`).toBe(403);
      expect((await jsonOf<ErrorBody>(res)).error.code).toBe("FORBIDDEN_ROLE");
    }
  });

  it.each(routes)("%s lets an allowed role past the guard", async (_name, handler, method, allowed) => {
    const res = await handler(apiRequest("/x", { method, role: allowed[0] }), { params: Promise.resolve(p) });
    expect(res.status).not.toBe(403);
  });
});

describe("reviewer passcode", () => {
  const withCode = { "x-reviewer-passcode": "open-sesame" };
  beforeEach(() => {
    teardownTestApp();
    setupTestApp({ UPLOAD_DIR: uploadDir, REVIEWER_PASSCODE: "open-sesame" });
  });

  it("is required on POST /api/jobs/:id/verify", async () => {
    const job = await authorizedJob();
    const call = (headers?: Record<string, string>) =>
      verify(apiRequest("/x", { role: "reviewer", body: {}, headers }), params({ id: job.id }));
    const denied = await call();
    expect(denied.status).toBe(403);
    expect((await jsonOf<ErrorBody>(denied)).error.code).toBe("REVIEWER_PASSCODE_REQUIRED");
    expect((await call({ "x-reviewer-passcode": "wrong" })).status).toBe(403);
    expect((await call(withCode)).status).toBe(409); // past the guard: nothing to verify yet
  });

  it("a reviewer cookie without the passcode does not reveal the liveness code", async () => {
    const job = await authorizedJob();
    const get = async (role: Role, headers?: Record<string, string>) =>
      (await jsonOf<{ job: Job }>(await getJobRoute(apiRequest("/x", { role, headers }), params({ id: job.id })))).job;
    expect((await get("reviewer")).livenessCode).toBeUndefined();
    expect((await get("reviewer", { "x-reviewer-passcode": "wrong" })).livenessCode).toBeUndefined();
    expect((await get("reviewer", withCode)).livenessCode).toBe(job.livenessCode);
    expect((await get("worker")).livenessCode).toBe(job.livenessCode);
    expect((await get("customer")).livenessCode).toBeUndefined();
  });
});

describe("request size limits", () => {
  it("refuses a JSON body above the limit by Content-Length and by actual size", async () => {
    const declared = new Request("http://x", {
      method: "POST",
      headers: { "content-length": String(MAX_JSON_BYTES + 1) },
      body: "{}",
    });
    await expect(readJson(declared)).rejects.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    const actual = new Request("http://x", { method: "POST", body: JSON.stringify({ x: "a".repeat(MAX_JSON_BYTES) }) });
    await expect(readJson(actual)).rejects.toMatchObject({ status: 413 });
    const fine = new Request("http://x", { method: "POST", body: JSON.stringify({ x: "a".repeat(1000) }) });
    await expect(readJson(fine)).resolves.toMatchObject({ x: expect.any(String) });
  });

  it("answers 413 on a route for an oversized JSON body", async () => {
    const res = await createJobRoute(
      apiRequest("/x", { role: "customer", body: { title: "a".repeat(MAX_JSON_BYTES) } }),
      params({}),
    );
    expect(res.status).toBe(413);
  });

  it("refuses an upload whose declared size is above 4 x 8 MB before reading it", async () => {
    const job = await authorizedJob();
    const body = new FormData();
    body.append("phase", "after");
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { cookie: "pp_role=worker", "content-length": String(40 * 1024 * 1024) },
      body,
    });
    const formData = vi.spyOn(req, "formData");
    const res = await postEvidence(req, params({ id: job.id }));
    expect(res.status).toBe(413);
    expect((await jsonOf<ErrorBody>(res)).error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(formData).not.toHaveBeenCalled();
  });

  it("refuses more than 4 files in one upload", async () => {
    const job = await authorizedJob();
    const form = new FormData();
    form.append("phase", "after");
    for (let i = 1; i <= 5; i += 1) form.append("files", await photo(i));
    const res = await postEvidence(
      apiRequest("/x", { method: "POST", role: "worker", body: form }),
      params({ id: job.id }),
    );
    expect(res.status).toBe(400);
    expect((await jsonOf<ErrorBody>(res)).error.code).toBe("TOO_MANY_FILES");
  });
});

describe("mock vision switch has one meaning", () => {
  it("health reports mock when VISION_MOCK is unset or 1, and real only when it is 0", async () => {
    const mockVision = async (value: string | undefined) => {
      if (value === undefined) vi.stubEnv("VISION_MOCK", "");
      else vi.stubEnv("VISION_MOCK", value);
      return (await jsonOf<{ mockVision: boolean }>(health())).mockVision;
    };
    expect(await mockVision(undefined)).toBe(true);
    expect(await mockVision("1")).toBe(true);
    expect(await mockVision("0")).toBe(false);
  });

  it("the orchestrator tells the verifier to mock when VISION_MOCK is unset", async () => {
    const job = await authorizedJob();
    const form = new FormData();
    form.append("phase", "after");
    form.append("files", await photo(7));
    await postEvidence(apiRequest("/x", { method: "POST", role: "worker", body: form }), params({ id: job.id }));
    const { transition } = await import("@/server/escrow/machine");
    transition(job.id, "EVIDENCE_SUBMITTED", "worker");
    vi.stubEnv("VISION_MOCK", "");
    resetEnvCache();
    let seen: boolean | undefined;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runVerification(job.id, {
      verifier: async (input) => {
        seen = input.mock;
        throw new Error("stop here");
      },
    });
    expect(seen).toBe(true);
    expect(getJob(job.id)?.status).toBe("HUMAN_REVIEW");
  });
});

describe("no secrets in logs or errors", () => {
  it("a failed PayPal call never prints or returns the client secret or the token", async () => {
    vi.stubEnv("PAYPAL_MOCK", "0");
    vi.stubEnv("PAYPAL_CLIENT_ID", "client-id-visible");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "s3cr3t-value-never-logged");
    resetEnvCache();
    resetTokenCache();
    const printed: string[] = [];
    for (const level of ["info", "warn", "error", "log"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        printed.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : JSON.stringify(arg))).join(" "));
      });
    }
    const responses = [
      () => Response.json({ access_token: "tok-never-logged", expires_in: 3600 }),
      () => Response.json({ name: "INTERNAL_SERVER_ERROR", debug_id: "dbg" }, { status: 500 }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => (responses.shift() ?? (() => Promise.reject(new TypeError("fetch failed"))))()));
    await getAccessToken();
    const error = await ppFetch("/v2/checkout/orders/X").catch((e: unknown) => e);
    const failing = await ppFetch("/v2/checkout/orders", { method: "POST", body: {} }).catch((e: unknown) => e);
    const text = [...printed, String(error), JSON.stringify(error), String(failing), JSON.stringify(failing)].join("\n");
    expect(text).not.toContain("s3cr3t-value-never-logged");
    expect(text).not.toContain("tok-never-logged");
    resetTokenCache();
  });
});
