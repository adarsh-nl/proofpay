import { beforeEach, describe, expect, it } from "vitest";
import type {
  Decision,
  ForensicsReport,
  VerificationReport,
} from "@/shared/contracts";
import {
  createDb,
  runMigrations,
  type ProofPayDb,
} from "@/server/db/client";
import {
  createJob,
  deleteEvidence,
  getEvidenceRowBySha,
  getJob,
  getPayment,
  hasEvent,
  insertEvent,
  insertEvidence,
  insertVerification,
  listEvidence,
  listJobs,
  listVerifications,
  replaceCriteria,
  setLivenessCode,
  setStatus,
  upsertPayment,
  type CreateJobInput,
} from "@/server/db/repo";
import { buildTemplateCriteria } from "@/server/vision/criteria-templates";

let db: ProofPayDb;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

function makeJobInput(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    title: "Replace bike chain",
    description: "Swap the worn chain for a new one.",
    category: "bike_repair",
    amountCents: 6000,
    currency: "USD",
    customerName: "Demo customer",
    workerName: "Demo worker",
    criteria: buildTemplateCriteria("bike_repair"),
    ...overrides,
  };
}

const report: VerificationReport = {
  verdicts: [
    {
      criterionId: "c1",
      verdict: "PASS",
      confidence: 0.95,
      rationale: "Chain is clearly new.",
      evidence: [{ imageId: "A1", box_2d: [100, 100, 300, 500], note: "chain" }],
    },
  ],
  sameScene: { verdict: "SAME", confidence: 0.9, rationale: "Same bike frame." },
  livenessCode: { found: true, readValue: "4821", imageId: "A1" },
  imageQualityIssues: ["NONE"],
  summary: "Chain replaced.",
};

const forensics: ForensicsReport = { flags: [] };

const decision: Decision = {
  outcome: "APPROVED",
  score: 1,
  captureAmount: { currency: "USD", value: "60.00" },
  reasons: ["all required criteria PASS"],
};

describe("createJob / getJob", () => {
  it("creates a CREATED job with template criteria and an audit event", () => {
    const job = createJob(makeJobInput(), db);
    expect(job.id).toBeTruthy();
    expect(job.status).toBe("CREATED");
    expect(job.amount).toEqual({ currency: "USD", value: "60.00" });
    expect(job.criteria).toHaveLength(5);
    expect(job.criteria.at(-1)?.id).toBe("cL");
    expect(job.criteria.at(-1)?.label).toContain("{CODE}");
    expect(job.events).toHaveLength(1);
    expect(job.events[0]).toMatchObject({
      type: "STATUS_CHANGED",
      toStatus: "CREATED",
      actor: "customer",
    });
    expect(job.createdAt).toBe(job.updatedAt);
  });

  it("round-trips an explicit id and returns null for unknown ids", () => {
    const created = createJob(makeJobInput({ id: "demo-bike" }), db);
    expect(created.id).toBe("demo-bike");
    const fetched = getJob("demo-bike", db);
    expect(fetched?.title).toBe("Replace bike chain");
    expect(getJob("nope", db)).toBeNull();
  });

  it("keeps criteria in c1..cN, cL order", () => {
    const job = createJob(
      makeJobInput({
        category: "cleaning",
        criteria: buildTemplateCriteria("cleaning"),
      }),
      db,
    );
    expect(job.criteria.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4", "c5", "cL"]);
  });
});

describe("listJobs / setStatus", () => {
  it("lists jobs and filters by status", () => {
    createJob(makeJobInput({ id: "a" }), db);
    createJob(makeJobInput({ id: "b", category: "delivery" }), db);
    expect(listJobs(undefined, db)).toHaveLength(2);

    setStatus("a", "AUTHORIZED", db);
    const authorized = listJobs("AUTHORIZED", db);
    expect(authorized.map((job) => job.id)).toEqual(["a"]);
    expect(authorized[0].status).toBe("AUTHORIZED");
    expect(getJob("a", db)?.status).toBe("AUTHORIZED");
    expect(listJobs("CREATED", db).map((job) => job.id)).toEqual(["b"]);
  });

  it("updates updatedAt when status changes", () => {
    const job = createJob(makeJobInput({ id: "a" }), db);
    setStatus("a", "AUTHORIZED", db);
    const updated = getJob("a", db);
    expect(updated?.status).toBe("AUTHORIZED");
    // ISO strings sort lexicographically; same-millisecond writes are allowed.
    expect((updated?.updatedAt ?? "") >= job.updatedAt).toBe(true);
  });
});

describe("events", () => {
  it("appends events with increasing ids and keeps data", () => {
    createJob(makeJobInput({ id: "a" }), db);
    const first = insertEvent(
      {
        jobId: "a",
        type: "REVIEW",
        fromStatus: "HUMAN_REVIEW",
        toStatus: "APPROVED",
        actor: "reviewer",
        data: { notes: "looks good", decision: "APPROVE" },
      },
      db,
    );
    const second = insertEvent(
      { jobId: "a", type: "PAYPAL_CALL", actor: "system", data: { op: "capture" } },
      db,
    );
    expect(second.id).toBeGreaterThan(first.id);
    expect(hasEvent("a", ["REVIEW"], db)).toBe(true);
    expect(hasEvent("a", ["SETTLEMENT_ACCEPTED"], db)).toBe(false);
    expect(hasEvent("a", [], db)).toBe(false);

    const job = getJob("a", db);
    expect(job?.events).toHaveLength(3);
    const review = job?.events.find((event) => event.type === "REVIEW");
    expect(review?.data).toEqual({ notes: "looks good", decision: "APPROVE" });
    expect(review?.actor).toBe("reviewer");
  });
});

describe("replaceCriteria / setLivenessCode", () => {
  it("replaces the criteria list atomically", () => {
    createJob(makeJobInput({ id: "a" }), db);
    const replacement = buildTemplateCriteria("delivery").slice(0, 2);
    replaceCriteria("a", replacement, db);
    expect(getJob("a", db)?.criteria).toHaveLength(2);
    expect(getJob("a", db)?.criteria[0].id).toBe("c1");
  });

  it("stores the liveness code and fills the {CODE} placeholder", () => {
    createJob(makeJobInput({ id: "a" }), db);
    setLivenessCode("a", "4821", db);
    const job = getJob("a", db);
    expect(job?.livenessCode).toBe("4821");
    const liveness = job?.criteria.find((criterion) => criterion.id === "cL");
    expect(liveness?.label).toContain("4821");
    expect(liveness?.label).not.toContain("{CODE}");
  });
});

describe("payments", () => {
  it("inserts and merges payment fields", () => {
    createJob(makeJobInput({ id: "a" }), db);
    expect(getPayment("a", db)).toBeNull();

    upsertPayment(
      "a",
      {
        paypalOrderId: "MOCK-ORDER-1",
        authorizationId: "MOCK-AUTH-1",
        authorizationStatus: "CREATED",
        authorizedCents: 6000,
        authorizationExpiresAt: "2026-12-09T00:00:00.000Z",
        honorPeriodEndsAt: "2026-11-13T00:00:00.000Z",
        captureIds: [],
      },
      db,
    );
    const payment = getPayment("a", db);
    expect(payment?.orderId).toBe("MOCK-ORDER-1");
    expect(payment?.authorized).toEqual({ currency: "USD", value: "60.00" });
    expect(payment?.captured).toEqual({ currency: "USD", value: "0.00" });

    upsertPayment("a", { capturedCents: 6000, captureIds: ["MOCK-CAP-1"] }, db);
    const captured = getPayment("a", db);
    expect(captured?.captured).toEqual({ currency: "USD", value: "60.00" });
    expect(captured?.captureIds).toEqual(["MOCK-CAP-1"]);
    // untouched fields survive a partial upsert
    expect(captured?.authorizationId).toBe("MOCK-AUTH-1");
    expect(getJob("a", db)?.payment?.captured.value).toBe("60.00");
  });
});

describe("evidence", () => {
  it("inserts, lists and deletes evidence", () => {
    createJob(makeJobInput({ id: "a" }), db);
    createJob(makeJobInput({ id: "b" }), db);
    const before = insertEvidence(
      {
        jobId: "a",
        phase: "before",
        path: "a/before_1.jpg",
        mime: "image/jpeg",
        width: 800,
        height: 600,
        sha256: "aa".repeat(32),
        dhash: "0123456789abcdef",
        uploadedAt: "2026-11-10T12:00:00.000Z",
      },
      db,
    );
    expect(before.url).toBe("/api/uploads/a/before_1.jpg");
    insertEvidence(
      {
        jobId: "b",
        phase: "after",
        path: "b/after_1.jpg",
        mime: "image/jpeg",
        width: 800,
        height: 600,
        sha256: "bb".repeat(32),
        dhash: "fedcba9876543210",
        exifTakenAt: "2026-11-10T11:00:00.000Z",
      },
      db,
    );

    expect(listEvidence(undefined, db)).toHaveLength(2);
    expect(listEvidence("a", db)).toHaveLength(1);
    expect(listEvidence("a", db)[0].phase).toBe("before");
    expect(getEvidenceRowBySha("aa".repeat(32), db)).toHaveLength(1);

    expect(deleteEvidence("a", before.id, db)).toBe(true);
    expect(deleteEvidence("a", before.id, db)).toBe(false);
    expect(listEvidence("a", db)).toHaveLength(0);
  });
});

describe("verifications", () => {
  it("stores bundles and returns the latest attempt with the job", () => {
    createJob(makeJobInput({ id: "a" }), db);
    const first = insertVerification(
      {
        jobId: "a",
        attempt: 1,
        model: "mock-vlm",
        mock: true,
        report,
        forensics,
        decision,
      },
      db,
    );
    const second = insertVerification(
      {
        jobId: "a",
        attempt: 2,
        model: "mock-vlm",
        mock: true,
        report,
        forensics,
        decision,
      },
      db,
    );
    expect(second.id).not.toBe(first.id);
    expect(listVerifications("a", db)).toHaveLength(2);
    const job = getJob("a", db);
    expect(job?.latestVerification?.attempt).toBe(2);
    expect(job?.latestVerification?.decision.outcome).toBe("APPROVED");
    expect(job?.latestVerification?.report.livenessCode.readValue).toBe("4821");
  });
});
