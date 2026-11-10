import "server-only";
import type { CreateJobBody, Criterion, Job } from "@/shared/contracts";
import { toCents } from "@/shared/money";
import { getDb, type ProofPayDb } from "@/server/db/client";
import { createJob, getJob, replaceCriteria } from "@/server/db/repo";
import { getEnv } from "@/server/env";
import { ConflictError, NotFoundError, ValidationError } from "@/server/http/errors";
import { generateCriteria } from "@/server/vision/criteria";
import { buildTemplateCriteria } from "@/server/vision/criteria-templates";

export const LIVENESS_CRITERION_ID = "cL";

export function requireJob(jobId: string, db: ProofPayDb = getDb()): Job {
  const job = getJob(jobId, db);
  if (!job) throw new NotFoundError("Job");
  return job;
}

/**
 * Re-normalise weights so they sum to exactly 1 (integer thousandths; the last
 * item absorbs rounding). All-zero weights become equal weights.
 */
export function normaliseWeights<T extends { weight: number }>(items: T[]): T[] {
  if (items.length === 0) return items;
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  const shares =
    total > 0
      ? items.map((item) => Math.round((item.weight / total) * 1000))
      : items.map(() => Math.round(1000 / items.length));
  const drift = 1000 - shares.reduce((sum, share) => sum + share, 0);
  const last = shares.length - 1;
  shares[last] = Math.max(0, (shares[last] ?? 0) + drift);
  return items.map((item, index) => ({ ...item, weight: (shares[index] ?? 0) / 1000 }));
}

/** MANUAL §8 #1. */
export async function createJobFromBody(
  body: CreateJobBody,
  db: ProofPayDb = getDb(),
): Promise<Job> {
  const env = getEnv();
  const currency = env.CURRENCY;
  if (body.amount.currency !== currency) {
    throw new ValidationError(`Amounts must be in ${currency}.`, "CURRENCY_NOT_SUPPORTED");
  }
  // Falls back to the category templates on mock mode, timeout or any AI error.
  const criteria = await generateCriteria(
    {
      title: body.title,
      description: body.description,
      category: body.category,
      amount: body.amount,
      customerName: body.customerName,
      workerName: body.workerName,
    },
    { mock: env.VISION_MOCK },
  );
  const job = createJob(
    {
      title: body.title,
      description: body.description,
      category: body.category,
      amountCents: toCents(body.amount.value),
      currency,
      customerName: body.customerName,
      workerName: body.workerName,
      criteria,
    },
    db,
  );
  return job;
}

/**
 * MANUAL §8 #4: only while `CREATED`; the system liveness criterion is kept as
 * stored (it cannot be removed or edited); other weights are re-normalised.
 */
export function updateCriteria(
  jobId: string,
  incoming: Criterion[],
  db: ProofPayDb = getDb(),
): Job {
  const job = requireJob(jobId, db);
  if (job.status !== "CREATED") {
    throw new ConflictError(
      "The checklist can only be edited before the payment is authorized.",
      "CRITERIA_LOCKED",
    );
  }
  const editable = incoming.filter(
    (criterion) => criterion.id !== LIVENESS_CRITERION_ID && criterion.source !== "system",
  );
  if (editable.length === 0) {
    throw new ValidationError("Keep at least one checklist item.", "CRITERIA_EMPTY");
  }
  if (new Set(editable.map((criterion) => criterion.id)).size !== editable.length) {
    throw new ValidationError("Checklist item ids must be unique.", "CRITERIA_DUPLICATE_ID");
  }
  const liveness =
    job.criteria.find((criterion) => criterion.id === LIVENESS_CRITERION_ID) ??
    buildTemplateCriteria(job.category).find((criterion) => criterion.id === LIVENESS_CRITERION_ID);
  const next = [...normaliseWeights(editable), ...(liveness ? [liveness] : [])];
  replaceCriteria(jobId, next, db);
  return requireJob(jobId, db);
}
