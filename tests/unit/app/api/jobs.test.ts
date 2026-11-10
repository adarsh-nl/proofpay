import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUT as putCriteria } from "@/app/api/jobs/[id]/criteria/route";
import { DELETE as deleteEvidence } from "@/app/api/jobs/[id]/evidence/[evidenceId]/route";
import { GET as listEvidenceRoute, POST as postEvidence } from "@/app/api/jobs/[id]/evidence/route";
import { GET as getJobRoute } from "@/app/api/jobs/[id]/route";
import { POST as submit } from "@/app/api/jobs/[id]/submit/route";
import { GET as listJobsRoute, POST as createJobRoute } from "@/app/api/jobs/route";
import { GET as reviewQueue } from "@/app/api/review-queue/route";
import { POST as setRole } from "@/app/api/role/route";
import { GET as getUpload } from "@/app/api/uploads/[jobId]/[file]/route";
import { getJob } from "@/server/db/repo";
import { transition } from "@/server/escrow/machine";
import { normaliseWeights } from "@/server/jobs/jobs";
import { authorizeOrder, createOrder } from "@/server/paypal/orders";
import type { Criterion, EvidenceItem, Job, JobListItem } from "@/shared/contracts";
import { apiRequest, jsonOf, makeJob, params, setupTestApp, teardownTestApp } from "../../helpers";

type ErrorBody = { error: { code: string; message: string } };
const none = params({});
let uploadDir: string;

beforeEach(() => {
  uploadDir = mkdtempSync(path.join(tmpdir(), "pp-uploads-"));
  setupTestApp({ UPLOAD_DIR: uploadDir });
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  teardownTestApp();
  vi.restoreAllMocks();
  rmSync(uploadDir, { recursive: true, force: true });
});

async function image(seed: number, format: "jpeg" | "png" | "webp" = "jpeg"): Promise<File> {
  const pipeline = sharp({
    create: { width: 80, height: 60, channels: 3, background: { r: seed % 255, g: 90, b: 160 } },
  });
  const bytes = await pipeline[format]().toBuffer();
  return new File([new Uint8Array(bytes)], `photo-${seed}.${format}`, { type: `image/${format}` });
}

async function authorizedJob(): Promise<Job> {
  const job = makeJob();
  const { orderId } = await createOrder(job.id);
  return authorizeOrder(orderId, job.id);
}

async function upload(jobId: string, phase: string, files: File[], role: "worker" | "customer" = "worker") {
  const form = new FormData();
  form.append("phase", phase);
  for (const file of files) form.append("files", file);
  return postEvidence(
    apiRequest(`/api/jobs/${jobId}/evidence`, { method: "POST", role, body: form }),
    params({ id: jobId }),
  );
}

const validBody = {
  title: "Replace bike chain",
  description: "Fit a new chain and lubricate it.",
  category: "bike_repair",
  amount: { currency: "USD", value: "60.00" },
};

describe("POST /api/jobs and GET /api/jobs", () => {
  it("creates a job in CREATED with template criteria ending in the liveness criterion", async () => {
    const res = await createJobRoute(apiRequest("/api/jobs", { role: "customer", body: validBody }), none);
    expect(res.status).toBe(201);
    const { job } = await jsonOf<{ job: Job }>(res);
    expect(job.status).toBe("CREATED");
    expect(job.amount).toEqual({ currency: "USD", value: "60.00" });
    expect(job.criteria.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4", "cL"]);
    const scored = job.criteria.filter((c) => c.id !== "cL").reduce((sum, c) => sum + c.weight, 0);
    expect(scored).toBeCloseTo(1, 6);
    expect(job.criteria.at(-1)).toMatchObject({ id: "cL", required: true, weight: 0, source: "system" });
    expect(job.criteria.at(-1)?.label).toContain("{CODE}");

    const list = await jsonOf<{ jobs: JobListItem[] }>(await listJobsRoute(apiRequest("/api/jobs"), none));
    expect(list.jobs).toEqual([
      expect.objectContaining({ id: job.id, status: "CREATED", title: "Replace bike chain" }),
    ]);
  });

  it("rejects the wrong role (403), a bad body (400) and another currency (400)", async () => {
    const wrongRole = await createJobRoute(apiRequest("/api/jobs", { role: "worker", body: validBody }), none);
    expect(wrongRole.status).toBe(403);
    const noRole = await createJobRoute(apiRequest("/api/jobs", { body: validBody }), none);
    expect(noRole.status).toBe(403);
    const bad = await createJobRoute(
      apiRequest("/api/jobs", { role: "customer", body: { ...validBody, amount: { currency: "USD", value: "0" } } }),
      none,
    );
    expect(bad.status).toBe(400);
    const eur = await createJobRoute(
      apiRequest("/api/jobs", { role: "customer", body: { ...validBody, amount: { currency: "EUR", value: "5.00" } } }),
      none,
    );
    expect(eur.status).toBe(400);
    expect((await jsonOf<ErrorBody>(eur)).error.code).toBe("CURRENCY_NOT_SUPPORTED");
  });
});

describe("GET /api/jobs/:id", () => {
  it("returns 404 for an unknown job", async () => {
    const res = await getJobRoute(apiRequest("/api/jobs/nope"), params({ id: "nope" }));
    expect(res.status).toBe(404);
    expect((await jsonOf<ErrorBody>(res)).error.code).toBe("NOT_FOUND");
  });

  it("shows the liveness code to worker and reviewer only", async () => {
    const job = await authorizedJob();
    const as = async (role?: "customer" | "worker" | "reviewer") =>
      (await jsonOf<{ job: Job }>(await getJobRoute(apiRequest("/x", { role }), params({ id: job.id })))).job;
    expect((await as("worker")).livenessCode).toBe(job.livenessCode);
    expect((await as("reviewer")).livenessCode).toBe(job.livenessCode);
    expect((await as("customer")).livenessCode).toBeUndefined();
    expect((await as()).livenessCode).toBeUndefined();
  });
});

describe("PUT /api/jobs/:id/criteria", () => {
  const item = (id: string, weight: number, extra: Partial<Criterion> = {}): Criterion => ({
    id,
    label: `Label ${id}`,
    howToVerify: "Look at it.",
    required: false,
    weight,
    phase: "after",
    source: "user",
    ...extra,
  });
  const put = (id: string, criteria: Criterion[], role: "customer" | "worker" = "customer") =>
    putCriteria(apiRequest("/x", { method: "PUT", role, body: { criteria } }), params({ id }));

  it("re-normalises weights and keeps the stored liveness criterion", async () => {
    const job = makeJob();
    const res = await put(job.id, [item("c1", 2), item("c2", 1), item("c3", 1)].map((c) => ({ ...c, weight: c.weight / 4 })));
    expect(res.status).toBe(200);
    const updated = (await jsonOf<{ job: Job }>(res)).job;
    expect(updated.criteria.map((c) => [c.id, c.weight])).toEqual([
      ["c1", 0.5],
      ["c2", 0.25],
      ["c3", 0.25],
      ["cL", 0],
    ]);
  });

  it("ignores attempts to drop or edit the liveness criterion", async () => {
    const job = makeJob();
    const res = await put(job.id, [
      item("c1", 0.3),
      item("cL", 0.7, { label: "edited", required: false, source: "user" }),
    ]);
    const updated = (await jsonOf<{ job: Job }>(res)).job;
    const liveness = updated.criteria.find((c) => c.id === "cL");
    expect(liveness).toMatchObject({ required: true, weight: 0, source: "system" });
    expect(liveness?.label).not.toBe("edited");
    expect(updated.criteria.find((c) => c.id === "c1")?.weight).toBe(1);
  });

  it("rejects an empty list, duplicate ids, the wrong role and a job that is not CREATED", async () => {
    const job = makeJob();
    expect((await put(job.id, [item("cL", 0, { source: "system" })])).status).toBe(400);
    expect((await put(job.id, [item("c1", 0.5), item("c1", 0.5)])).status).toBe(400);
    expect((await put(job.id, [item("c1", 1)], "worker")).status).toBe(403);
    const authorized = await authorizedJob();
    const locked = await put(authorized.id, [item("c1", 1)]);
    expect(locked.status).toBe(409);
    expect((await jsonOf<ErrorBody>(locked)).error.code).toBe("CRITERIA_LOCKED");
  });
});

describe("normaliseWeights", () => {
  it("sums to exactly 1 in thousandths", () => {
    const weights = normaliseWeights([{ weight: 1 }, { weight: 1 }, { weight: 1 }]).map((w) => w.weight);
    expect(weights).toEqual([0.333, 0.333, 0.334]);
    expect(normaliseWeights([{ weight: 0 }, { weight: 0 }]).map((w) => w.weight)).toEqual([0.5, 0.5]);
    expect(normaliseWeights([])).toEqual([]);
  });
});

describe("evidence upload, delete and serving", () => {
  it("stores re-encoded JPEGs, lists them and serves them", async () => {
    const job = await authorizedJob();
    const res = await upload(job.id, "after", [await image(1, "png"), await image(2, "webp")]);
    expect(res.status).toBe(201);
    const { evidence } = await jsonOf<{ evidence: EvidenceItem[] }>(res);
    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({ jobId: job.id, phase: "after", mime: "image/jpeg", width: 80, height: 60 });
    expect(evidence[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence[0]?.dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(evidence[0]?.url).toBe(`/api/uploads/${job.id}/after_1.jpg`);

    const listed = await jsonOf<{ evidence: EvidenceItem[] }>(
      await listEvidenceRoute(apiRequest("/x"), params({ id: job.id })),
    );
    expect(listed.evidence.map((e) => e.id)).toEqual(evidence.map((e) => e.id));

    const served = await getUpload(apiRequest("/x"), params({ jobId: job.id, file: "after_1.jpg" }));
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(await served.arrayBuffer())).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
  });

  it("enforces the per-phase limit across uploads", async () => {
    const job = await authorizedJob();
    expect((await upload(job.id, "before", [await image(1), await image(2), await image(3)])).status).toBe(201);
    const over = await upload(job.id, "before", [await image(4), await image(5)]);
    expect(over.status).toBe(400);
    expect((await jsonOf<ErrorBody>(over)).error.code).toBe("TOO_MANY_FILES");
    expect((await upload(job.id, "after", [await image(6)])).status).toBe(201);
  });

  it("rejects oversize files, HEIC, non-images, a bad phase and no files", async () => {
    const job = await authorizedJob();
    const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" });
    const oversize = await upload(job.id, "after", [big]);
    expect(oversize.status).toBe(413);
    expect((await jsonOf<ErrorBody>(oversize)).error.code).toBe("FILE_TOO_LARGE");

    const heic = await upload(job.id, "after", [new File([new Uint8Array(10)], "IMG_1.HEIC", { type: "image/heic" })]);
    expect(heic.status).toBe(400);
    expect((await jsonOf<ErrorBody>(heic)).error.message).toContain("HEIC");

    const text = await upload(job.id, "after", [new File(["not an image"], "note.jpg", { type: "image/jpeg" })]);
    expect(text.status).toBe(400);

    expect((await upload(job.id, "during", [await image(1)])).status).toBe(400);
    expect((await upload(job.id, "after", [])).status).toBe(400);
    expect(getJob(job.id)?.status).toBe("AUTHORIZED");
  });

  it("requires the worker role and a job whose payment is held", async () => {
    const job = await authorizedJob();
    expect((await upload(job.id, "after", [await image(1)], "customer")).status).toBe(403);
    const created = makeJob();
    const early = await upload(created.id, "after", [await image(1)]);
    expect(early.status).toBe(409);
    expect((await jsonOf<ErrorBody>(early)).error.code).toBe("EVIDENCE_LOCKED");
  });

  it("deletes one photo and its file", async () => {
    const job = await authorizedJob();
    const { evidence } = await jsonOf<{ evidence: EvidenceItem[] }>(await upload(job.id, "after", [await image(1)]));
    const id = evidence[0]?.id ?? "";
    const del = (evidenceId: string, role: "worker" | "customer" = "worker") =>
      deleteEvidence(apiRequest("/x", { method: "DELETE", role }), params({ id: job.id, evidenceId }));
    expect((await del(id, "customer")).status).toBe(403);
    expect((await del(id)).status).toBe(204);
    expect((await del(id)).status).toBe(404);
    const served = await getUpload(apiRequest("/x"), params({ jobId: job.id, file: "after_1.jpg" }));
    expect(served.status).toBe(404);
  });

  it("blocks path traversal and unknown files", async () => {
    writeFileSync(path.join(uploadDir, "..", "pp-secret.jpg"), "secret");
    for (const [jobId, file] of [
      ["..", "pp-secret.jpg"],
      ["x", "../pp-secret.jpg"],
      ["x", "..%2Fpp-secret.jpg"],
      ["x", "after_1.jpg/../../pp-secret.jpg"],
      ["../..", "after_1.jpg"],
      ["x", "after_1.png"],
      ["x", "after_1.jpg"],
    ] as const) {
      const res = await getUpload(apiRequest("/x"), params({ jobId, file }));
      expect(res.status, `${jobId}/${file}`).toBe(404);
    }
    rmSync(path.join(uploadDir, "..", "pp-secret.jpg"), { force: true });
  });
});

describe("POST /api/jobs/:id/submit", () => {
  const post = (id: string, role: "worker" | "customer" = "worker") =>
    submit(apiRequest("/x", { role, body: {} }), params({ id }));

  it("needs at least one after photo", async () => {
    const job = await authorizedJob();
    await upload(job.id, "before", [await image(1)]);
    const res = await post(job.id);
    expect(res.status).toBe(400);
    expect((await jsonOf<ErrorBody>(res)).error.code).toBe("NO_AFTER_EVIDENCE");
  });

  it("returns 202, records EVIDENCE_SUBMITTED and starts verification", async () => {
    const job = await authorizedJob();
    await upload(job.id, "after", [await image(1)]);
    const res = await post(job.id);
    expect(res.status).toBe(202);
    const body = await jsonOf<{ job: Job }>(res);
    expect(body.job.status).toBe("EVIDENCE_SUBMITTED");
    await vi.waitFor(() => expect(getJob(job.id)?.status).not.toBe("EVIDENCE_SUBMITTED"));
    const statuses = getJob(job.id)?.events.filter((e) => e.type === "STATUS_CHANGED").map((e) => e.toStatus);
    expect(statuses?.slice(0, 3)).toEqual(["CREATED", "AUTHORIZED", "EVIDENCE_SUBMITTED"]);
  });

  it("rejects the wrong role (403), a second submit (409) and locks evidence after submit", async () => {
    const job = await authorizedJob();
    await upload(job.id, "after", [await image(1)]);
    expect((await post(job.id, "customer")).status).toBe(403);
    expect((await post(job.id)).status).toBe(202);
    expect((await post(job.id)).status).toBe(409);
    expect((await upload(job.id, "after", [await image(2)])).status).toBe(409);
  });

  it("allows exactly one resubmission after a rejection", async () => {
    const job = await authorizedJob();
    await upload(job.id, "after", [await image(1)]);
    transition(job.id, "EVIDENCE_SUBMITTED", "worker");
    transition(job.id, "VERIFYING", "system");
    transition(job.id, "REJECTED", "system");
    expect((await post(job.id)).status).toBe(202);
    await vi.waitFor(() => expect(getJob(job.id)?.status).not.toBe("EVIDENCE_SUBMITTED"));
    if (getJob(job.id)?.status === "VERIFYING") transition(job.id, "REJECTED", "system");
    if (getJob(job.id)?.status === "REJECTED") {
      const again = await post(job.id);
      expect(again.status).toBe(409);
      expect((await jsonOf<ErrorBody>(again)).error.code).toBe("RETRY_LIMIT_REACHED");
    }
  });
});

describe("GET /api/review-queue", () => {
  it("lists HUMAN_REVIEW jobs for the reviewer only", async () => {
    const job = await authorizedJob();
    for (const to of ["EVIDENCE_SUBMITTED", "VERIFYING", "HUMAN_REVIEW"] as const) transition(job.id, to, "system");
    makeJob();
    expect((await reviewQueue(apiRequest("/x", { role: "customer" }), none)).status).toBe(403);
    const res = await reviewQueue(apiRequest("/x", { role: "reviewer" }), none);
    const body = await jsonOf<{ jobs: JobListItem[] }>(res);
    expect(body.jobs.map((j) => j.id)).toEqual([job.id]);
  });

  it("needs the passcode header when REVIEWER_PASSCODE is set", async () => {
    teardownTestApp();
    setupTestApp({ UPLOAD_DIR: uploadDir, REVIEWER_PASSCODE: "open-sesame" });
    const missing = await reviewQueue(apiRequest("/x", { role: "reviewer" }), none);
    expect(missing.status).toBe(403);
    const error = (await jsonOf<ErrorBody>(missing)).error;
    expect(error.code).toBe("REVIEWER_PASSCODE_REQUIRED");
    expect(error.message.toLowerCase()).toContain("passcode");
    const wrong = await reviewQueue(
      apiRequest("/x", { role: "reviewer", headers: { "x-reviewer-passcode": "nope" } }),
      none,
    );
    expect(wrong.status).toBe(403);
    const ok = await reviewQueue(
      apiRequest("/x", { role: "reviewer", headers: { "x-reviewer-passcode": "open-sesame" } }),
      none,
    );
    expect(ok.status).toBe(200);
  });
});

describe("POST /api/role", () => {
  it("sets the pp_role cookie for 7 days", async () => {
    const res = await setRole(apiRequest("/api/role", { body: { role: "worker" } }), none);
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("pp_role=worker");
    expect(cookie).toContain("Path=/");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Max-Age=604800");
  });

  it("rejects an unknown role", async () => {
    const res = await setRole(apiRequest("/api/role", { body: { role: "admin" } }), none);
    expect(res.status).toBe(400);
  });
});

describe("photo numbering after a delete", () => {
  it("renumbers files at submit so A1..An match upload order", async () => {
    const job = await authorizedJob();
    const { evidence } = await jsonOf<{ evidence: EvidenceItem[] }>(
      await upload(job.id, "after", [await image(1), await image(2), await image(3)]),
    );
    await upload(job.id, "before", [await image(4)]);
    const second = await sharp(
      Buffer.from(await (await getUpload(apiRequest("/x"), params({ jobId: job.id, file: "after_2.jpg" }))).arrayBuffer()),
    ).stats();
    await deleteEvidence(
      apiRequest("/x", { method: "DELETE", role: "worker" }),
      params({ id: job.id, evidenceId: evidence[0]?.id ?? "" }),
    );
    const res = await submit(apiRequest("/x", { role: "worker", body: {} }), params({ id: job.id }));
    expect(res.status).toBe(202);

    const listed = await jsonOf<{ evidence: EvidenceItem[] }>(
      await listEvidenceRoute(apiRequest("/x"), params({ id: job.id })),
    );
    expect(listed.evidence.filter((e) => e.phase === "after").map((e) => e.url)).toEqual([
      `/api/uploads/${job.id}/after_1.jpg`,
      `/api/uploads/${job.id}/after_2.jpg`,
    ]);
    expect(listed.evidence.filter((e) => e.phase === "after").map((e) => e.id)).toEqual([evidence[1]?.id, evidence[2]?.id]);
    const first = await getUpload(apiRequest("/x"), params({ jobId: job.id, file: "after_1.jpg" }));
    expect(first.status).toBe(200);
    // after_1.jpg is now the photo that was uploaded second.
    const stats = await sharp(Buffer.from(await first.arrayBuffer())).stats();
    expect(stats.channels[0]?.mean).toBeCloseTo(second.channels[0]?.mean ?? -1, 0);
    expect((await getUpload(apiRequest("/x"), params({ jobId: job.id, file: "after_3.jpg" }))).status).toBe(404);
    expect((await getUpload(apiRequest("/x"), params({ jobId: job.id, file: "before_1.jpg" }))).status).toBe(200);
  });
});
