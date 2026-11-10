/**
 * Drizzle schema — mirrors docs/MANUAL.md §6 exactly (SQLite).
 * Money is stored as integer minor units (`*_cents`) plus `currency`; times are
 * ISO-8601 UTC strings. Only `repo.ts` reads/writes these tables.
 */

import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("CREATED"),
    livenessCode: text("liveness_code"),
    customerName: text("customer_name"),
    workerName: text("worker_name"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("jobs_status_idx").on(table.status)],
);

export const criteria = sqliteTable(
  "criteria",
  {
    // ids are 'c1'..'cN' / 'cL', scoped by job.
    id: text("id").notNull(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    howToVerify: text("how_to_verify").notNull(),
    required: integer("required", { mode: "boolean" }).notNull(),
    weight: real("weight").notNull(),
    phase: text("phase").notNull(),
    source: text("source").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.id] }),
    index("criteria_job_idx").on(table.jobId),
  ],
);

export const payments = sqliteTable("payments", {
  jobId: text("job_id")
    .primaryKey()
    .references(() => jobs.id, { onDelete: "cascade" }),
  paypalOrderId: text("paypal_order_id"),
  authorizationId: text("authorization_id"),
  authorizationStatus: text("authorization_status"),
  authorizedCents: integer("authorized_cents").notNull().default(0),
  authorizationExpiresAt: text("authorization_expires_at"),
  honorPeriodEndsAt: text("honor_period_ends_at"),
  capturedCents: integer("captured_cents").notNull().default(0),
  captureIds: text("capture_ids"), // JSON string[]
  refundedCents: integer("refunded_cents").notNull().default(0),
  voidedAt: text("voided_at"),
});

export const evidence = sqliteTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    path: text("path").notNull(), // relative to UPLOAD_DIR
    mime: text("mime").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sha256: text("sha256").notNull(),
    dhash: text("dhash").notNull(), // 16 hex chars (64-bit)
    exifTakenAt: text("exif_taken_at"),
    exifJson: text("exif_json"),
    uploadedAt: text("uploaded_at").notNull(),
  },
  (table) => [
    index("evidence_job_idx").on(table.jobId),
    index("evidence_sha256_idx").on(table.sha256),
  ],
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    model: text("model").notNull(),
    mock: integer("mock", { mode: "boolean" }).notNull().default(false),
    reportJson: text("report_json").notNull(),
    forensicsJson: text("forensics_json").notNull(),
    decisionJson: text("decision_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("verifications_job_idx").on(table.jobId)],
);

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // STATUS_CHANGED | PAYPAL_CALL | AGENT_MESSAGE | REVIEW | WEBHOOK
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    actor: text("actor").notNull(), // customer | worker | reviewer | system | agent
    dataJson: text("data_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("events_job_idx").on(table.jobId)],
);

export const paypalIdempotency = sqliteTable("paypal_idempotency", {
  key: text("key").primaryKey(), // `${jobId}:${op}:${n}`
  requestId: text("request_id").notNull(),
  responseJson: text("response_json"),
});

export type JobRow = typeof jobs.$inferSelect;
export type CriteriaRow = typeof criteria.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type EvidenceRow = typeof evidence.$inferSelect;
export type VerificationRow = typeof verifications.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type PaypalIdempotencyRow = typeof paypalIdempotency.$inferSelect;
