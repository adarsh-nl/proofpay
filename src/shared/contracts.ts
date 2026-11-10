/**
 * ProofPay shared contract — zod schemas and inferred types for every API
 * boundary (docs/MANUAL.md §8, §9.2–§9.4). This file is the source of truth:
 * `docs/MANUAL.md` mirrors it. Changing it requires a `contract-change` PR.
 *
 * Isomorphic: no node imports. Both the UI (`src/lib`) and the server import it.
 */

import { z } from "zod";
import { ESCROW_STATUSES } from "./escrow";

/* ------------------------------------------------------------------ roles */

export const ROLES = ["customer", "worker", "reviewer"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

/* ------------------------------------------------------------- primitives */

export const EscrowStatusSchema = z.enum(ESCROW_STATUSES);
export type EscrowStatus = z.infer<typeof EscrowStatusSchema>;

export const JOB_CATEGORIES = [
  "bike_repair",
  "cleaning",
  "assembly",
  "delivery",
  "other",
] as const;
export const JobCategorySchema = z.enum(JOB_CATEGORIES);
export type JobCategory = z.infer<typeof JobCategorySchema>;

/** ISO 4217 currency code + decimal string amount, e.g. `{currency:"USD", value:"120.00"}`. */
export const MoneySchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/, "ISO 4217 currency code"),
  value: z
    .string()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, 'decimal amount string, e.g. "120.00"'),
});
export type Money = z.infer<typeof MoneySchema>;

/** Uploaded evidence phase. */
export const EvidencePhaseSchema = z.enum(["before", "after"]);
export type EvidencePhase = z.infer<typeof EvidencePhaseSchema>;

/* -------------------------------------------------------------- criteria */

export const CriterionSchema = z.object({
  id: z.string().min(1).max(50),
  label: z.string().min(1).max(300),
  howToVerify: z.string().min(1).max(1000),
  required: z.boolean(),
  weight: z.number().min(0).max(1),
  phase: z.enum(["after", "before_after"]),
  source: z.enum(["llm", "user", "system"]),
});
export type Criterion = z.infer<typeof CriterionSchema>;

/* --------------------------------------------- vision report (MANUAL §9.2) */

/** Normalised box `[ymin, xmin, ymax, xmax]`, coordinates 0..1000. */
export const BoxSchema = z.object({
  imageId: z.string(),
  box_2d: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  note: z.string().max(140),
});
export type Box = z.infer<typeof BoxSchema>;

export const CRITERION_VERDICTS = [
  "PASS",
  "FAIL",
  "UNCERTAIN",
  "NOT_VISIBLE",
] as const;
export const CriterionVerdictSchema = z.object({
  criterionId: z.string(),
  verdict: z.enum(CRITERION_VERDICTS),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(400),
  evidence: z.array(BoxSchema).max(4),
});
export type CriterionVerdict = z.infer<typeof CriterionVerdictSchema>;

export const IMAGE_QUALITY_ISSUES = [
  "BLURRY",
  "TOO_DARK",
  "TOO_FAR",
  "OBSTRUCTED",
  "SCREENSHOT_OF_SCREEN",
  "NONE",
] as const;
export const ImageQualityIssueSchema = z.enum(IMAGE_QUALITY_ISSUES);
export type ImageQualityIssue = z.infer<typeof ImageQualityIssueSchema>;

export const VerificationReportSchema = z.object({
  verdicts: z.array(CriterionVerdictSchema),
  sameScene: z.object({
    verdict: z.enum(["SAME", "DIFFERENT", "UNSURE"]),
    confidence: z.number().min(0).max(1),
    rationale: z.string().max(300),
  }),
  livenessCode: z.object({
    found: z.boolean(),
    readValue: z.string().nullable(),
    imageId: z.string().nullable(),
  }),
  imageQualityIssues: z.array(ImageQualityIssueSchema),
  summary: z.string().max(500),
});
export type VerificationReport = z.infer<typeof VerificationReportSchema>;

/* ------------------------------------------ forensics report (MANUAL §9.3) */

export const FORENSICS_FLAG_CODES = [
  "EXACT_DUPLICATE",
  "NEAR_DUPLICATE",
  "NO_CHANGE",
  "EXIF_BEFORE_AUTH",
  "EXIF_MISSING",
  "SCENE_MISMATCH",
  "SCREENSHOT",
] as const;
export const ForensicsFlagCodeSchema = z.enum(FORENSICS_FLAG_CODES);
export type ForensicsFlagCode = z.infer<typeof ForensicsFlagCodeSchema>;

export const FORENSICS_LEVELS = ["HIGH", "MEDIUM", "INFO"] as const;
export const ForensicsLevelSchema = z.enum(FORENSICS_LEVELS);
export type ForensicsLevel = z.infer<typeof ForensicsLevelSchema>;

export const ForensicsFlagSchema = z.object({
  code: ForensicsFlagCodeSchema,
  level: ForensicsLevelSchema,
  message: z.string(),
  evidenceIds: z.array(z.string()),
});
export type ForensicsFlag = z.infer<typeof ForensicsFlagSchema>;

export const ForensicsReportSchema = z.object({
  flags: z.array(ForensicsFlagSchema),
});
export type ForensicsReport = z.infer<typeof ForensicsReportSchema>;

/* ----------------------------------------- decision engine (MANUAL §9.4) */

export const DECISION_OUTCOMES = [
  "APPROVED",
  "PARTIAL",
  "REJECTED",
  "HUMAN_REVIEW",
] as const;
export const DecisionOutcomeSchema = z.enum(DECISION_OUTCOMES);
export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;

export const DecisionSchema = z.object({
  outcome: DecisionOutcomeSchema,
  score: z.number().min(0).max(1),
  captureAmount: MoneySchema.optional(),
  reasons: z.array(z.string()),
});
export type Decision = z.infer<typeof DecisionSchema>;

/* ------------------------------------------------- settlement proposal (§8) */

export const SettlementProposalSchema = z.object({
  proposalId: z.string(),
  kind: z.literal("PARTIAL_CAPTURE"),
  captureAmount: MoneySchema,
  releaseAmount: MoneySchema,
  explanation: z.string(),
  basedOnVerificationId: z.string(),
});
export type SettlementProposal = z.infer<typeof SettlementProposalSchema>;

/* ---------------------------------------------------- payments / timeline */

export const PaymentSummarySchema = z.object({
  orderId: z.string().optional(),
  authorizationId: z.string().optional(),
  authorizationStatus: z.string().optional(),
  authorized: MoneySchema.optional(),
  captured: MoneySchema,
  refunded: MoneySchema,
  expiresAt: z.string().optional(),
  honorPeriodEndsAt: z.string().optional(),
  captureIds: z.array(z.string()),
});
export type PaymentSummary = z.infer<typeof PaymentSummarySchema>;

export const EVENT_TYPES = [
  "STATUS_CHANGED",
  "PAYPAL_CALL",
  "AGENT_MESSAGE",
  "REVIEW",
  "WEBHOOK",
] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventItemSchema = z.object({
  id: z.number().int(),
  type: z.string(),
  fromStatus: EscrowStatusSchema.nullish(),
  toStatus: EscrowStatusSchema.nullish(),
  actor: z.string(),
  data: z.unknown().optional(),
  createdAt: z.string(),
});
export type EventItem = z.infer<typeof EventItemSchema>;

/* --------------------------------------------------------------- evidence */

export const EvidenceItemSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  phase: EvidencePhaseSchema,
  sha256: z.string(),
  dhash: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  mime: z.string(),
  exifTakenAt: z.string().nullable().optional(),
  uploadedAt: z.string(),
  /** Same-origin URL that serves the re-encoded image (GPS EXIF stripped). */
  url: z.string(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

/* ------------------------------------------------------ verification bundle */

export const VerificationBundleSchema = z.object({
  id: z.string(),
  attempt: z.number().int(),
  model: z.string(),
  mock: z.boolean(),
  report: VerificationReportSchema,
  forensics: ForensicsReportSchema,
  decision: DecisionSchema,
  createdAt: z.string(),
});
export type VerificationBundle = z.infer<typeof VerificationBundleSchema>;

/* ------------------------------------------------------------------- jobs */

export const JobSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: JobCategorySchema,
  amount: MoneySchema,
  status: EscrowStatusSchema,
  /** Only returned to the worker and reviewer roles (MANUAL §8 #3, C9). */
  livenessCode: z.string().optional(),
  customerName: z.string().optional(),
  workerName: z.string().optional(),
  criteria: z.array(CriterionSchema),
  payment: PaymentSummarySchema.optional(),
  latestVerification: VerificationBundleSchema.optional(),
  events: z.array(EventItemSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Job = z.infer<typeof JobSchema>;

export const JobListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: EscrowStatusSchema,
  amount: MoneySchema,
  updatedAt: z.string(),
});
export type JobListItem = z.infer<typeof JobListItemSchema>;

/* ------------------------------------------------------ request body schemas */

export const CreateJobBodySchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(3).max(2000),
  category: JobCategorySchema,
  amount: MoneySchema.refine(
    (money) => Number(money.value) > 0,
    "amount must be greater than zero",
  ),
  customerName: z.string().max(120).optional(),
  workerName: z.string().max(120).optional(),
});
export type CreateJobBody = z.infer<typeof CreateJobBodySchema>;

export const UpdateCriteriaBodySchema = z.object({
  criteria: z.array(CriterionSchema).min(1).max(12),
});
export type UpdateCriteriaBody = z.infer<typeof UpdateCriteriaBodySchema>;

export const CreateOrderBodySchema = z.object({
  jobId: z.string().min(1),
});
export type CreateOrderBody = z.infer<typeof CreateOrderBodySchema>;

export const AuthorizeBodySchema = z.object({
  jobId: z.string().min(1),
});
export type AuthorizeBody = z.infer<typeof AuthorizeBodySchema>;

export const SubmitBodySchema = z.object({});
export type SubmitBody = z.infer<typeof SubmitBodySchema>;

export const AcceptBodySchema = z.object({
  proposalId: z.string().min(1),
});
export type AcceptBody = z.infer<typeof AcceptBodySchema>;

export const DeclineBodySchema = z.object({
  proposalId: z.string().min(1),
  reason: z.string().min(1).max(500),
});
export type DeclineBody = z.infer<typeof DeclineBodySchema>;

export const REVIEW_DECISIONS = ["APPROVE", "PARTIAL", "REJECT"] as const;
export const ReviewDecisionSchema = z.enum(REVIEW_DECISIONS);
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export const ReviewBodySchema = z
  .object({
    decision: ReviewDecisionSchema,
    amount: MoneySchema.optional(),
    notes: z.string().max(2000).default(""),
  })
  .superRefine((body, ctx) => {
    if (body.decision === "PARTIAL" && !body.amount) {
      ctx.addIssue({
        code: "custom",
        message: "amount is required when decision is PARTIAL",
        path: ["amount"],
      });
    }
  });
export type ReviewBody = z.infer<typeof ReviewBodySchema>;

export const VoidBodySchema = z.object({
  reason: z.string().min(1).max(500),
});
export type VoidBody = z.infer<typeof VoidBodySchema>;

export const RefundBodySchema = z.object({
  amount: MoneySchema.optional(),
  reason: z.string().min(1).max(500),
});
export type RefundBody = z.infer<typeof RefundBodySchema>;

export const VerifyBodySchema = z.object({
  force: z.boolean().optional(),
});
export type VerifyBody = z.infer<typeof VerifyBodySchema>;

export const RoleBodySchema = z.object({
  role: RoleSchema,
});
export type RoleBody = z.infer<typeof RoleBodySchema>;

export const EvidencePackBodySchema = z.object({});
export type EvidencePackBody = z.infer<typeof EvidencePackBodySchema>;

/* --------------------------------------------------------------- responses */

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const JobResponseSchema = z.object({ job: JobSchema });
export type JobResponse = z.infer<typeof JobResponseSchema>;

export const JobListResponseSchema = z.object({
  jobs: z.array(JobListItemSchema),
});
export type JobListResponse = z.infer<typeof JobListResponseSchema>;

/* ----------------------------------------------------------------- limits */

/** C9 evidence rules. */
export const MAX_EVIDENCE_FILES_PER_PHASE = 4;
export const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
export const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
