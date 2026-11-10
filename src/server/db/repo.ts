import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  DecisionSchema,
  ForensicsReportSchema,
  VerificationReportSchema,
  type Criterion,
  type Decision,
  type EscrowStatus,
  type EventItem,
  type EvidenceItem,
  type EvidencePhase,
  type ForensicsReport,
  type Job,
  type JobCategory,
  type JobListItem,
  type Money,
  type PaymentSummary,
  type VerificationBundle,
  type VerificationReport,
} from "@/shared/contracts";
import { fromCents } from "@/shared/money";
import { getDb, type ProofPayDb } from "./client";
import * as t from "./schema";

/* ------------------------------------------------------------------ helpers */

function nowIso(): string {
  return new Date().toISOString();
}

function toMoney(cents: number, currency: string): Money {
  return { currency, value: fromCents(cents) };
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function criteriaSortKey(criterion: { id: string }): number {
  if (criterion.id === "cL") return 1000;
  const numeric = Number.parseInt(criterion.id.replace(/\D/g, ""), 10);
  return Number.isFinite(numeric) ? numeric : 999;
}

function toCriterion(row: t.CriteriaRow): Criterion {
  return {
    id: row.id,
    label: row.label,
    howToVerify: row.howToVerify,
    required: row.required,
    weight: row.weight,
    phase: row.phase === "before_after" ? "before_after" : "after",
    source:
      row.source === "system" ? "system" : row.source === "user" ? "user" : "llm",
  };
}

function toPaymentSummary(row: t.PaymentRow, currency: string): PaymentSummary {
  const summary: PaymentSummary = {
    captured: toMoney(row.capturedCents, currency),
    refunded: toMoney(row.refundedCents, currency),
    captureIds: parseJson<string[]>(row.captureIds) ?? [],
  };
  if (row.paypalOrderId) summary.orderId = row.paypalOrderId;
  if (row.authorizationId) summary.authorizationId = row.authorizationId;
  if (row.authorizationStatus) summary.authorizationStatus = row.authorizationStatus;
  if (row.authorizedCents > 0) {
    summary.authorized = toMoney(row.authorizedCents, currency);
  }
  if (row.authorizationExpiresAt) summary.expiresAt = row.authorizationExpiresAt;
  if (row.honorPeriodEndsAt) summary.honorPeriodEndsAt = row.honorPeriodEndsAt;
  return summary;
}

function toEvidenceItem(row: t.EvidenceRow): EvidenceItem {
  return {
    id: row.id,
    jobId: row.jobId,
    phase: row.phase === "before" ? "before" : "after",
    sha256: row.sha256,
    dhash: row.dhash,
    width: row.width,
    height: row.height,
    mime: row.mime,
    exifTakenAt: row.exifTakenAt,
    uploadedAt: row.uploadedAt,
    url: `/api/uploads/${row.jobId}/${basename(row.path)}`,
  };
}

function toEventItem(row: t.EventRow): EventItem {
  const item: EventItem = {
    id: row.id,
    type: row.type,
    actor: row.actor,
    createdAt: row.createdAt,
    data: parseJson<unknown>(row.dataJson) ?? undefined,
  };
  if (row.fromStatus) item.fromStatus = row.fromStatus as EscrowStatus;
  if (row.toStatus) item.toStatus = row.toStatus as EscrowStatus;
  return item;
}

function toVerificationBundle(row: t.VerificationRow): VerificationBundle {
  return {
    id: row.id,
    attempt: row.attempt,
    model: row.model,
    mock: row.mock,
    report: VerificationReportSchema.parse(
      parseJson(row.reportJson) ?? {},
    ) as VerificationReport,
    forensics: ForensicsReportSchema.parse(
      parseJson(row.forensicsJson) ?? {},
    ) as ForensicsReport,
    decision: DecisionSchema.parse(parseJson(row.decisionJson) ?? {}) as Decision,
    createdAt: row.createdAt,
  };
}

/* ------------------------------------------------------------------- inputs */

export interface CreateJobInput {
  id?: string;
  title: string;
  description: string;
  category: JobCategory;
  amountCents: number;
  currency?: string;
  customerName?: string;
  workerName?: string;
  criteria: Criterion[];
}

export interface UpdatePaymentInput {
  paypalOrderId?: string;
  authorizationId?: string;
  authorizationStatus?: string;
  authorizedCents?: number;
  authorizationExpiresAt?: string | null;
  honorPeriodEndsAt?: string | null;
  capturedCents?: number;
  captureIds?: string[];
  refundedCents?: number;
  voidedAt?: string | null;
}

export interface InsertEvidenceInput {
  id?: string;
  jobId: string;
  phase: EvidencePhase;
  path: string;
  mime: string;
  width: number;
  height: number;
  sha256: string;
  dhash: string;
  exifTakenAt?: string | null;
  exifJson?: string | null;
  uploadedAt?: string;
}

export interface InsertVerificationInput {
  id?: string;
  jobId: string;
  attempt: number;
  model: string;
  mock: boolean;
  report: VerificationReport;
  forensics: ForensicsReport;
  decision: Decision;
  createdAt?: string;
}

export interface InsertEventInput {
  jobId: string;
  type: string;
  fromStatus?: EscrowStatus | null;
  toStatus?: EscrowStatus | null;
  actor: string;
  data?: unknown;
  createdAt?: string;
}

/* --------------------------------------------------------------------- jobs */

export function createJob(input: CreateJobInput, db: ProofPayDb = getDb()): Job {
  const id = input.id ?? randomUUID();
  const now = nowIso();
  const currency = input.currency ?? process.env.CURRENCY ?? "USD";
  db.transaction((tx) => {
    tx.insert(t.jobs)
      .values({
        id,
        title: input.title,
        description: input.description,
        category: input.category,
        amountCents: input.amountCents,
        currency,
        status: "CREATED",
        customerName: input.customerName ?? null,
        workerName: input.workerName ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    if (input.criteria.length > 0) {
      tx.insert(t.criteria)
        .values(
          input.criteria.map((criterion) => ({
            id: criterion.id,
            jobId: id,
            label: criterion.label,
            howToVerify: criterion.howToVerify,
            required: criterion.required,
            weight: criterion.weight,
            phase: criterion.phase,
            source: criterion.source,
          })),
        )
        .run();
    }
    tx.insert(t.events)
      .values({
        jobId: id,
        type: "STATUS_CHANGED",
        fromStatus: null,
        toStatus: "CREATED",
        actor: "customer",
        dataJson: JSON.stringify({ title: input.title }),
        createdAt: now,
      })
      .run();
  });
  const job = getJob(id, db);
  if (!job) throw new Error(`[repo] job ${id} not found after create`);
  return job;
}

export function getJob(jobId: string, db: ProofPayDb = getDb()): Job | null {
  const row = db.select().from(t.jobs).where(eq(t.jobs.id, jobId)).get();
  if (!row) return null;

  const criteria = db
    .select()
    .from(t.criteria)
    .where(eq(t.criteria.jobId, jobId))
    .all()
    .map(toCriterion)
    .sort((a, b) => criteriaSortKey(a) - criteriaSortKey(b));

  const paymentRow = db
    .select()
    .from(t.payments)
    .where(eq(t.payments.jobId, jobId))
    .get();

  const verificationRow = db
    .select()
    .from(t.verifications)
    .where(eq(t.verifications.jobId, jobId))
    .orderBy(desc(t.verifications.attempt))
    .limit(1)
    .get();

  const eventRows = db
    .select()
    .from(t.events)
    .where(eq(t.events.jobId, jobId))
    .orderBy(asc(t.events.id))
    .all();

  const job: Job = {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category as JobCategory,
    amount: toMoney(row.amountCents, row.currency),
    status: row.status as EscrowStatus,
    criteria,
    events: eventRows.map(toEventItem),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.livenessCode) job.livenessCode = row.livenessCode;
  if (row.customerName) job.customerName = row.customerName;
  if (row.workerName) job.workerName = row.workerName;
  if (paymentRow) job.payment = toPaymentSummary(paymentRow, row.currency);
  if (verificationRow) {
    job.latestVerification = toVerificationBundle(verificationRow);
  }
  return job;
}

export function listJobs(
  status?: EscrowStatus,
  db: ProofPayDb = getDb(),
): JobListItem[] {
  const rows = (
    status
      ? db.select().from(t.jobs).where(eq(t.jobs.status, status))
      : db.select().from(t.jobs)
  )
    .orderBy(desc(t.jobs.updatedAt))
    .all();
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status as EscrowStatus,
    amount: toMoney(row.amountCents, row.currency),
    updatedAt: row.updatedAt,
  }));
}

export function replaceCriteria(
  jobId: string,
  criteria: Criterion[],
  db: ProofPayDb = getDb(),
): Criterion[] {
  db.transaction((tx) => {
    tx.delete(t.criteria).where(eq(t.criteria.jobId, jobId)).run();
    if (criteria.length > 0) {
      tx.insert(t.criteria)
        .values(
          criteria.map((criterion) => ({
            id: criterion.id,
            jobId,
            label: criterion.label,
            howToVerify: criterion.howToVerify,
            required: criterion.required,
            weight: criterion.weight,
            phase: criterion.phase,
            source: criterion.source,
          })),
        )
        .run();
    }
    tx.update(t.jobs)
      .set({ updatedAt: nowIso() })
      .where(eq(t.jobs.id, jobId))
      .run();
  });
  return criteria;
}

/**
 * Internal: every status change must go through `transition()` in
 * `src/server/escrow/machine.ts` (AGENTS.md §8). Nothing else may call this.
 */
export function setStatus(
  jobId: string,
  status: EscrowStatus,
  db: ProofPayDb = getDb(),
): void {
  db.update(t.jobs)
    .set({ status, updatedAt: nowIso() })
    .where(eq(t.jobs.id, jobId))
    .run();
}

/** Store the 4-digit liveness code and fill `{CODE}` in the `cL` criterion label. */
export function setLivenessCode(
  jobId: string,
  livenessCode: string,
  db: ProofPayDb = getDb(),
): void {
  db.transaction((tx) => {
    tx.update(t.jobs)
      .set({ livenessCode, updatedAt: nowIso() })
      .where(eq(t.jobs.id, jobId))
      .run();
    const livenessRow = tx
      .select()
      .from(t.criteria)
      .where(and(eq(t.criteria.jobId, jobId), eq(t.criteria.id, "cL")))
      .get();
    if (livenessRow) {
      tx.update(t.criteria)
        .set({ label: livenessRow.label.replace("{CODE}", livenessCode) })
        .where(and(eq(t.criteria.jobId, jobId), eq(t.criteria.id, "cL")))
        .run();
    }
  });
}

/* ----------------------------------------------------------------- payments */

export function upsertPayment(
  jobId: string,
  input: UpdatePaymentInput,
  db: ProofPayDb = getDb(),
): void {
  const existing = db
    .select()
    .from(t.payments)
    .where(eq(t.payments.jobId, jobId))
    .get();
  const values = {
    jobId,
    paypalOrderId: input.paypalOrderId ?? existing?.paypalOrderId ?? null,
    authorizationId: input.authorizationId ?? existing?.authorizationId ?? null,
    authorizationStatus:
      input.authorizationStatus ?? existing?.authorizationStatus ?? null,
    authorizedCents: input.authorizedCents ?? existing?.authorizedCents ?? 0,
    authorizationExpiresAt:
      input.authorizationExpiresAt !== undefined
        ? input.authorizationExpiresAt
        : (existing?.authorizationExpiresAt ?? null),
    honorPeriodEndsAt:
      input.honorPeriodEndsAt !== undefined
        ? input.honorPeriodEndsAt
        : (existing?.honorPeriodEndsAt ?? null),
    capturedCents: input.capturedCents ?? existing?.capturedCents ?? 0,
    captureIds:
      input.captureIds !== undefined
        ? JSON.stringify(input.captureIds)
        : (existing?.captureIds ?? JSON.stringify([])),
    refundedCents: input.refundedCents ?? existing?.refundedCents ?? 0,
    voidedAt:
      input.voidedAt !== undefined
        ? input.voidedAt
        : (existing?.voidedAt ?? null),
  };
  if (existing) {
    db.update(t.payments).set(values).where(eq(t.payments.jobId, jobId)).run();
  } else {
    db.insert(t.payments).values(values).run();
  }
}

export function getPayment(
  jobId: string,
  db: ProofPayDb = getDb(),
): PaymentSummary | null {
  const row = db
    .select()
    .from(t.payments)
    .where(eq(t.payments.jobId, jobId))
    .get();
  if (!row) return null;
  const jobRow = db
    .select({ currency: t.jobs.currency })
    .from(t.jobs)
    .where(eq(t.jobs.id, jobId))
    .get();
  return toPaymentSummary(
    row,
    jobRow?.currency ?? process.env.CURRENCY ?? "USD",
  );
}

/* ----------------------------------------------------------------- evidence */

export function insertEvidence(
  input: InsertEvidenceInput,
  db: ProofPayDb = getDb(),
): EvidenceItem {
  const row: t.EvidenceRow = {
    id: input.id ?? randomUUID(),
    jobId: input.jobId,
    phase: input.phase,
    path: input.path,
    mime: input.mime,
    width: input.width,
    height: input.height,
    sha256: input.sha256,
    dhash: input.dhash,
    exifTakenAt: input.exifTakenAt ?? null,
    exifJson: input.exifJson ?? null,
    uploadedAt: input.uploadedAt ?? nowIso(),
  };
  db.transaction((tx) => {
    tx.insert(t.evidence).values(row).run();
    tx.update(t.jobs)
      .set({ updatedAt: row.uploadedAt })
      .where(eq(t.jobs.id, input.jobId))
      .run();
  });
  return toEvidenceItem(row);
}

export function listEvidence(
  jobId?: string,
  db: ProofPayDb = getDb(),
): EvidenceItem[] {
  const rows = (
    jobId
      ? db.select().from(t.evidence).where(eq(t.evidence.jobId, jobId))
      : db.select().from(t.evidence)
  )
    .orderBy(asc(t.evidence.uploadedAt))
    .all();
  return rows.map(toEvidenceItem);
}

export function deleteEvidence(
  jobId: string,
  evidenceId: string,
  db: ProofPayDb = getDb(),
): boolean {
  const result = db
    .delete(t.evidence)
    .where(and(eq(t.evidence.jobId, jobId), eq(t.evidence.id, evidenceId)))
    .run();
  return result.changes > 0;
}

/**
 * Raw evidence rows (with the on-disk `path`) for the server-side pipeline
 * (verification orchestrator, forensics). API responses use `listEvidence`.
 */
export function listEvidenceRows(
  jobId?: string,
  db: ProofPayDb = getDb(),
): t.EvidenceRow[] {
  return (
    jobId
      ? db.select().from(t.evidence).where(eq(t.evidence.jobId, jobId))
      : db.select().from(t.evidence)
  )
    .orderBy(asc(t.evidence.uploadedAt))
    .all();
}

/** Point an evidence row at a renamed file (`path` is relative to UPLOAD_DIR). */
export function updateEvidencePath(
  evidenceId: string,
  path: string,
  db: ProofPayDb = getDb(),
): void {
  db.update(t.evidence).set({ path }).where(eq(t.evidence.id, evidenceId)).run();
}

export function getEvidenceRowBySha(
  sha256: string,
  db: ProofPayDb = getDb(),
): t.EvidenceRow[] {
  return db.select().from(t.evidence).where(eq(t.evidence.sha256, sha256)).all();
}

/* ------------------------------------------------------------ verifications */

export function insertVerification(
  input: InsertVerificationInput,
  db: ProofPayDb = getDb(),
): VerificationBundle {
  const row: t.VerificationRow = {
    id: input.id ?? randomUUID(),
    jobId: input.jobId,
    attempt: input.attempt,
    model: input.model,
    mock: input.mock,
    reportJson: JSON.stringify(input.report),
    forensicsJson: JSON.stringify(input.forensics),
    decisionJson: JSON.stringify(input.decision),
    createdAt: input.createdAt ?? nowIso(),
  };
  db.transaction((tx) => {
    tx.insert(t.verifications).values(row).run();
    tx.update(t.jobs)
      .set({ updatedAt: row.createdAt })
      .where(eq(t.jobs.id, input.jobId))
      .run();
  });
  return toVerificationBundle(row);
}

export function listVerifications(
  jobId: string,
  db: ProofPayDb = getDb(),
): VerificationBundle[] {
  return db
    .select()
    .from(t.verifications)
    .where(eq(t.verifications.jobId, jobId))
    .orderBy(asc(t.verifications.attempt))
    .all()
    .map(toVerificationBundle);
}

/* ------------------------------------------------------------------- events */

export function insertEvent(
  input: InsertEventInput,
  db: ProofPayDb = getDb(),
): EventItem {
  const row = {
    jobId: input.jobId,
    type: input.type,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    actor: input.actor,
    dataJson: input.data === undefined ? null : JSON.stringify(input.data),
    createdAt: input.createdAt ?? nowIso(),
  };
  const result = db.insert(t.events).values(row).run();
  const item: EventItem = {
    id: Number(result.lastInsertRowid),
    type: row.type,
    actor: row.actor,
    createdAt: row.createdAt,
    data: input.data,
  };
  if (row.fromStatus) item.fromStatus = row.fromStatus;
  if (row.toStatus) item.toStatus = row.toStatus;
  return item;
}

export function listEvents(
  jobId: string,
  db: ProofPayDb = getDb(),
): EventItem[] {
  return db
    .select()
    .from(t.events)
    .where(eq(t.events.jobId, jobId))
    .orderBy(asc(t.events.id))
    .all()
    .map(toEventItem);
}

/** True when the job has at least one event whose type is in `types`. */
export function hasEvent(
  jobId: string,
  types: string[],
  db: ProofPayDb = getDb(),
): boolean {
  if (types.length === 0) return false;
  return (
    db
      .select({ id: t.events.id })
      .from(t.events)
      .where(and(eq(t.events.jobId, jobId), inArray(t.events.type, types)))
      .limit(1)
      .get() !== undefined
  );
}

/* -------------------------------------------------------------- idempotency */

export function getPaypalIdempotency(
  key: string,
  db: ProofPayDb = getDb(),
): t.PaypalIdempotencyRow | null {
  return (
    db
      .select()
      .from(t.paypalIdempotency)
      .where(eq(t.paypalIdempotency.key, key))
      .get() ?? null
  );
}

export function savePaypalIdempotency(
  key: string,
  requestId: string,
  response: unknown,
  db: ProofPayDb = getDb(),
): void {
  const values = {
    key,
    requestId,
    responseJson: response === undefined ? null : JSON.stringify(response),
  };
  db.insert(t.paypalIdempotency)
    .values(values)
    .onConflictDoUpdate({
      target: t.paypalIdempotency.key,
      set: { requestId: values.requestId, responseJson: values.responseJson },
    })
    .run();
}
