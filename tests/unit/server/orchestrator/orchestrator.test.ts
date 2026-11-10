import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import type { JobCategory } from "@/shared/contracts";
import { fromCents } from "@/shared/money";
import {
  createDb,
  runMigrations,
  type ProofPayDb,
} from "@/server/db/client";
import {
  createJob,
  getJob,
  getPayment,
  insertEvidence,
  listVerifications,
  upsertPayment,
} from "@/server/db/repo";
import { resetEnvCache } from "@/server/env";
import { transition } from "@/server/escrow/machine";
import { ppFetch } from "@/server/paypal/client";
import { resetPayPalMock } from "@/server/paypal/mock";
import { runVerification } from "@/server/vision/orchestrator";
import { buildTemplateCriteria } from "@/server/vision/criteria-templates";

let db: ProofPayDb;
let tmpRoot: string;
let uploadDir: string;
let sequence = 0;
let jobCounter = 0;

async function makeJpeg(color: { r: number; g: number; b: number }) {
  return sharp({
    create: { width: 80, height: 60, channels: 3, background: color },
  })
    .jpeg()
    .toBuffer();
}

beforeEach(async () => {
  process.env.VISION_MOCK = "1";
  process.env.PAYPAL_MOCK = "1";
  process.env.CURRENCY = "USD";
  process.env.AUTO_CAPTURE_ON_APPROVE = "1";
  resetEnvCache();
  resetPayPalMock();
  sequence += 1;

  tmpRoot = await mkdtemp(join(tmpdir(), "proofpay-orch-"));
  uploadDir = join(tmpRoot, "uploads");
  await mkdir(uploadDir, { recursive: true });

  db = createDb(":memory:");
  runMigrations(db);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function addEvidence(
  jobId: string,
  phase: "before" | "after",
  options: { sha256: string; dhash: string; index?: number },
) {
  const index = options.index ?? 1;
  const relativePath = `${jobId}/${phase}_${index}.jpg`;
  const absolutePath = join(uploadDir, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    await makeJpeg(
      phase === "before" ? { r: 20, g: 40, b: 60 } : { r: 200, g: 30, b: 10 },
    ),
  );
  return insertEvidence(
    {
      jobId,
      phase,
      path: relativePath,
      mime: "image/jpeg",
      width: 80,
      height: 60,
      sha256: options.sha256,
      dhash: options.dhash,
      exifTakenAt: null,
    },
    db,
  );
}

interface SubmittedJob {
  jobId: string;
  authorizationId: string;
}

/**
 * Create a job, authorize a mock PayPal order, upload before/after evidence
 * and move the job to EVIDENCE_SUBMITTED.
 */
async function createSubmittedJob(options: {
  category?: JobCategory;
  amountCents?: number;
  afterDhash?: string;
  afterSha?: string;
  beforeDhash?: string;
  withAfter?: boolean;
}): Promise<SubmittedJob> {
  const category = options.category ?? "bike_repair";
  const amountCents = options.amountCents ?? 6000;
  jobCounter += 1;
  const jobId = `orch-job-${sequence}-${jobCounter}-${category}`;
  createJob(
    {
      id: jobId,
      title: `Verification test ${category}`,
      description: "A job used by the orchestrator unit tests.",
      category,
      amountCents,
      currency: "USD",
      criteria: buildTemplateCriteria(category),
    },
    db,
  );

  const order = await ppFetch<{ id: string }>("/v2/checkout/orders", {
    method: "POST",
    idempotencyKey: `${jobId}:create:1`,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: jobId,
          custom_id: jobId,
          description: "ProofPay orchestrator test",
          amount: { currency_code: "USD", value: fromCents(amountCents) },
        },
      ],
    },
  });
  const authorized = await ppFetch<{
    purchase_units: Array<{ payments: { authorizations: Array<{ id: string }> } }>;
  }>(`/v2/checkout/orders/${order.id}/authorize`, {
    method: "POST",
    body: {},
    idempotencyKey: `${jobId}:authorize:1`,
  });
  const authorizationId =
    authorized.purchase_units[0].payments.authorizations[0].id;
  upsertPayment(
    jobId,
    {
      paypalOrderId: order.id,
      authorizationId,
      authorizationStatus: "CREATED",
      authorizedCents: amountCents,
      authorizationExpiresAt: new Date(Date.now() + 29 * 86_400_000).toISOString(),
      honorPeriodEndsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      captureIds: [],
    },
    db,
  );
  transition(jobId, "AUTHORIZED", "customer", { authorizationId }, db);
  // The real authorize route fills the code; mirror that here.
  const { setLivenessCode } = await import("@/server/db/repo");
  setLivenessCode(jobId, "4821", db);

  await addEvidence(jobId, "before", {
    sha256: `${jobId}-before-sha`.padEnd(64, "0"),
    dhash: options.beforeDhash ?? "0000000000000000",
  });
  if (options.withAfter !== false) {
    await addEvidence(jobId, "after", {
      sha256: options.afterSha ?? `${jobId}-after-sha`.padEnd(64, "f"),
      dhash: options.afterDhash ?? "ffffffffffffffff",
    });
  }
  transition(jobId, "EVIDENCE_SUBMITTED", "worker", {}, db);
  return { jobId, authorizationId };
}

describe("runVerification with VISION_MOCK=1", () => {
  it("approves a clean bike job, stores the bundle and auto-captures $60.00", async () => {
    const { jobId } = await createSubmittedJob({ category: "bike_repair" });
    const outcome = await runVerification(jobId, { db, uploadDir });
    expect(outcome?.decision.outcome).toBe("APPROVED");
    expect(outcome?.verification.mock).toBe(true);
    expect(outcome?.verification.attempt).toBe(1);
    expect(outcome?.job.status).toBe("CAPTURED");
    expect(getPayment(jobId, db)?.captured.value).toBe("60.00");

    const verifications = listVerifications(jobId, db);
    expect(verifications).toHaveLength(1);
    expect(verifications[0].report.livenessCode.readValue).toBe("4821");
    expect(getJob(jobId, db)?.latestVerification?.id).toBe(verifications[0].id);
  });

  it("stops at PARTIAL for the cleaning override and emits a $96/$24 proposal", async () => {
    const { jobId } = await createSubmittedJob({
      category: "cleaning",
      amountCents: 12000,
    });
    const outcome = await runVerification(jobId, { db, uploadDir });
    expect(outcome?.decision.outcome).toBe("PARTIAL");
    expect(outcome?.decision.captureAmount?.value).toBe("96.00");
    expect(outcome?.job.status).toBe("PARTIAL");
    expect(getPayment(jobId, db)?.captured.value).toBe("0.00");

    const message = getJob(jobId, db)
      ?.events.filter((event) => event.type === "AGENT_MESSAGE")
      .at(-1);
    const data = message?.data as {
      proposal?: { captureAmount: { value: string }; releaseAmount: { value: string } };
    };
    expect(data.proposal?.captureAmount.value).toBe("96.00");
    expect(data.proposal?.releaseAmount.value).toBe("24.00");
  });

  it("moves to HUMAN_REVIEW when the VLM throws", async () => {
    const { jobId } = await createSubmittedJob({ category: "bike_repair" });
    const outcome = await runVerification(jobId, {
      db,
      uploadDir,
      verifier: async () => {
        throw new Error("VLM exploded");
      },
    });
    expect(outcome).toBeNull();
    const job = getJob(jobId, db);
    expect(job?.status).toBe("HUMAN_REVIEW");
    const event = job?.events.at(-1);
    expect(event?.toStatus).toBe("HUMAN_REVIEW");
    expect(event?.data).toMatchObject({ reason: "VLM exploded" });
    expect(listVerifications(jobId, db)).toHaveLength(0);
  });

  it("does not run twice for a double submit", async () => {
    const { jobId } = await createSubmittedJob({ category: "bike_repair" });
    const first = await runVerification(jobId, { db, uploadDir });
    const second = await runVerification(jobId, { db, uploadDir });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(listVerifications(jobId, db)).toHaveLength(1);
    expect(getPayment(jobId, db)?.captured.value).toBe("60.00");
  });

  it("escalates a duplicate photo to HUMAN_REVIEW (HIGH forensics flag)", async () => {
    const duplicateSha = "d".repeat(64);
    const victim = await createSubmittedJob({
      category: "delivery",
      amountCents: 4500,
      afterSha: duplicateSha,
    });
    const other = await createSubmittedJob({
      category: "delivery",
      amountCents: 4500,
      afterSha: duplicateSha,
      withAfter: true,
    });
    expect(victim.jobId).not.toBe(other.jobId);

    const outcome = await runVerification(other.jobId, { db, uploadDir });
    expect(outcome?.decision.outcome).toBe("HUMAN_REVIEW");
    expect(outcome?.verification.forensics.flags.map((flag) => flag.code)).toContain(
      "EXACT_DUPLICATE",
    );
    expect(getJob(other.jobId, db)?.status).toBe("HUMAN_REVIEW");
  });

  it("escalates a submission without an after photo", async () => {
    const { jobId } = await createSubmittedJob({
      category: "bike_repair",
      withAfter: false,
    });
    const outcome = await runVerification(jobId, { db, uploadDir });
    expect(outcome).toBeNull();
    const job = getJob(jobId, db);
    expect(job?.status).toBe("HUMAN_REVIEW");
    expect(
      (job?.events.at(-1)?.data as { reason?: string } | undefined)?.reason,
    ).toContain("NO_AFTER_EVIDENCE");
  });

  it("does not re-run a captured job, even with force", async () => {
    const { jobId } = await createSubmittedJob({ category: "bike_repair" });
    await runVerification(jobId, { db, uploadDir });
    expect(getJob(jobId, db)?.status).toBe("CAPTURED");
    const again = await runVerification(jobId, { db, uploadDir, force: true });
    expect(again).toBeNull();
    expect(listVerifications(jobId, db)).toHaveLength(1);
  });
});
