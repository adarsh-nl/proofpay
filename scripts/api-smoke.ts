/**
 * API smoke test through the UI's own typed client (`src/lib/api-client.ts`).
 * Every response is zod-parsed by the client, so a shape mismatch between the
 * API and the UI fails here.
 *
 * Needs a running server in full mock mode with freshly seeded demo jobs:
 *   PAYPAL_MOCK=1 VISION_MOCK=1 npm run db:reset && npm run build && PORT=3001 npm start
 *   npx tsx scripts/api-smoke.ts http://localhost:3001
 *
 * Drives: demo-bike → CAPTURED, demo-cleaning → PARTIAL → accept → CAPTURED,
 * demo-delivery (stock photo) → HUMAN_REVIEW → reviewer reject → VOIDED.
 */
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { api, ApiClientError } from "../src/lib/api-client";
import { evidenceImageUrl } from "../src/lib/boxes";
import { SettlementProposalSchema, type Job, type Role } from "../src/shared/contracts";

const baseUrl = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const passcode = process.env.REVIEWER_PASSCODE;
const as = (role: Role) => ({
  baseUrl,
  headers: {
    cookie: `pp_role=${role}`,
    ...(role === "reviewer" && passcode ? { "x-reviewer-passcode": passcode } : {}),
  },
});

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures += 1;
}

/** Seeded block pattern (never a gradient), so different seeds have distant dHashes. */
async function image(seed: number): Promise<File> {
  const size = 32;
  const pixels = Buffer.alloc(size * size);
  let x = seed;
  for (let i = 0; i < pixels.length; i += 1) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    pixels[i] = x % 256;
  }
  const bytes = await sharp(pixels, { raw: { width: size, height: size, channels: 1 } })
    .resize(800, 600, { kernel: "nearest" })
    .jpeg({ quality: 85 })
    .toBuffer();
  return new File([new Uint8Array(bytes)], `synthetic-${seed}.jpg`, { type: "image/jpeg" });
}

async function hold(jobId: string): Promise<Job> {
  const { orderId } = await api.createOrder({ jobId }, as("customer"));
  const job = await api.authorize(orderId, { jobId }, as("customer"));
  check(`${jobId}: authorized`, job.status === "AUTHORIZED" && Boolean(job.payment?.authorizationId));
  check(`${jobId}: customer does not see the liveness code`, job.livenessCode === undefined);
  const forWorker = await api.getJob(jobId, as("worker"));
  check(`${jobId}: worker sees a 4-digit code`, /^\d{4}$/.test(forWorker.livenessCode ?? ""));
  return job;
}

async function settle(jobId: string): Promise<Job> {
  for (let i = 0; i < 60; i += 1) {
    const job = await api.getJob(jobId, as("customer"));
    if (job.status !== "EVIDENCE_SUBMITTED" && job.status !== "VERIFYING") return job;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${jobId}: verification did not finish`);
}

async function imagesLoad(job: Job): Promise<void> {
  const ids = new Set<string>();
  for (const verdict of job.latestVerification?.report.verdicts ?? []) {
    for (const box of verdict.evidence) ids.add(box.imageId);
  }
  check(`${job.id}: the report points at images`, ids.size > 0);
  for (const id of ids) {
    const res = await fetch(`${baseUrl}${evidenceImageUrl(job.id, id)}`);
    check(`${job.id}: image ${id} loads for the viewer`, res.status === 200, `HTTP ${res.status}`);
  }
}

async function bike(): Promise<void> {
  const id = "demo-bike";
  await hold(id);
  await api.uploadEvidence(id, "before", [await image(101)], as("worker"));
  // Upload two after photos and delete the first: image ids must still resolve.
  const after = await api.uploadEvidence(id, "after", [await image(102), await image(103)], as("worker"));
  await api.deleteEvidence(id, after[0]?.id ?? "", as("worker"));
  const listed = await api.listEvidence(id, as("worker"));
  check(`${id}: evidence list has 2 photos after a delete`, listed.length === 2);
  const submitted = await api.submitEvidence(id, as("worker"));
  check(`${id}: submit accepted`, submitted.status === "EVIDENCE_SUBMITTED" || submitted.status === "VERIFYING");
  const job = await settle(id);
  check(`${id}: CAPTURED`, job.status === "CAPTURED", job.status);
  check(`${id}: captured 60.00`, job.payment?.captured.value === "60.00", job.payment?.captured.value);
  check(`${id}: one capture id`, job.payment?.captureIds.length === 1);
  check(`${id}: every verdict is PASS`, job.latestVerification?.report.verdicts.every((v) => v.verdict === "PASS") ?? false);
  await imagesLoad(job);
}

async function cleaning(): Promise<void> {
  const id = "demo-cleaning";
  await hold(id);
  await api.uploadEvidence(id, "before", [await image(201)], as("worker"));
  await api.uploadEvidence(id, "after", [await image(202)], as("worker"));
  await api.submitEvidence(id, as("worker"));
  const job = await settle(id);
  check(`${id}: PARTIAL`, job.status === "PARTIAL", job.status);
  const event = [...job.events].reverse().find((e) => e.type === "AGENT_MESSAGE");
  const proposal = SettlementProposalSchema.safeParse(event?.data);
  check(`${id}: the latest AGENT_MESSAGE parses as a SettlementProposal`, proposal.success);
  if (!proposal.success) return;
  check(`${id}: proposal 96.00 / 24.00`, proposal.data.captureAmount.value === "96.00" && proposal.data.releaseAmount.value === "24.00");
  check(`${id}: explanation cites c4`, proposal.data.explanation.includes("c4"));
  await imagesLoad(job);
  const accepted = await api.acceptProposal(id, { proposalId: proposal.data.proposalId }, as("customer"));
  check(`${id}: CAPTURED after accept`, accepted.status === "CAPTURED", accepted.status);
  check(`${id}: captured 96.00 of 120.00`, accepted.payment?.captured.value === "96.00");
}

async function delivery(): Promise<void> {
  const id = "demo-delivery";
  await hold(id);
  const stock = await readFile("eval/stock/placeholder-doorstep-1.jpg");
  const file = new File([new Uint8Array(stock)], "doorstep.jpg", { type: "image/jpeg" });
  await api.uploadEvidence(id, "after", [file], as("worker"));
  await api.submitEvidence(id, as("worker"));
  const job = await settle(id);
  check(`${id}: HUMAN_REVIEW`, job.status === "HUMAN_REVIEW", job.status);
  const codes = job.latestVerification?.forensics.flags.map((f) => f.code) ?? [];
  check(`${id}: duplicate flag`, codes.includes("EXACT_DUPLICATE") || codes.includes("NEAR_DUPLICATE"), codes.join(","));
  check(`${id}: nothing captured`, job.payment?.captureIds.length === 0);
  const queue = await api.reviewQueue(as("reviewer"));
  check(`${id}: in the review queue`, queue.some((item) => item.id === id));
  const pack = await api.evidencePack(id, as("reviewer"));
  check(`${id}: evidence pack mentions the job and the flag`, pack.includes(id) && /DUPLICATE/.test(pack));
  const reviewed = await api.review(id, { decision: "REJECT", notes: "Reused stock photo." }, as("reviewer"));
  check(`${id}: VOIDED after reviewer reject`, reviewed.status === "VOIDED", reviewed.status);
  const forCustomer = await api.getJob(id, as("customer"));
  check(`${id}: customer sees VOIDED and no capture`, forCustomer.status === "VOIDED" && forCustomer.payment?.captured.value === "0.00");
}

async function guards(): Promise<void> {
  const expectError = async (label: string, status: number, run: () => Promise<unknown>) => {
    try {
      await run();
      check(label, false, "no error");
    } catch (error) {
      check(label, error instanceof ApiClientError && error.status === status, error instanceof ApiClientError ? `${error.status} ${error.code}` : String(error));
    }
  };
  await expectError("worker cannot create an order", 403, () => api.createOrder({ jobId: "demo-bike" }, as("worker")));
  await expectError("customer cannot read the review queue", 403, () => api.reviewQueue(as("customer")));
  await expectError("unknown job is 404", 404, () => api.getJob("nope", as("customer")));
  await expectError("captured job cannot be voided", 409, () => api.voidJob("demo-bike", { reason: "x" }, as("customer")));
}

async function main(): Promise<void> {
  const health = await api.health({ baseUrl });
  check("health ok, mock PayPal and mock vision", health.ok && health.mockPaypal === true && health.mockVision);
  const jobs = await api.listJobs({ baseUrl });
  check("three seeded demo jobs in CREATED", ["demo-bike", "demo-cleaning", "demo-delivery"].every((id) => jobs.some((j) => j.id === id && j.status === "CREATED")));
  await bike();
  await cleaning();
  await delivery();
  await guards();
  console.log(failures === 0 ? "\nAPI SMOKE PASSED" : `\nAPI SMOKE FAILED: ${failures} check(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error("API SMOKE CRASHED:", error instanceof ApiClientError ? `${error.status} ${error.code} ${error.message}` : error);
  process.exit(1);
});
