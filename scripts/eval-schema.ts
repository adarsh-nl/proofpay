/**
 * zod schema for the ProofPay eval set, shared by `npm run eval:validate` (A01) and
 * `npm run eval` (A02).
 *
 * One case per folder: `eval/pairs/<NN>-<slug>/case.json`, plus `before_*.jpg` /
 * `after_*.jpg` photos once the case is shot. `ready` stays false until the human has
 * added the photos, so the repo as committed always validates.
 *
 * Design notes:
 * - `criteria` (optional) are the JOB criteria used for the case. The system liveness
 *   criterion `cL` is NOT listed here: the pipeline appends it (required, weight 0).
 *   When absent, the runner generates criteria from `description` (T08).
 * - `expected.criteria` are the verdicts the verifier should return per criterion id.
 * - `expected.alternatives` records documented ambiguity (e.g. MANUAL §9.5 "REJECTED or
 *   HUMAN_REVIEW" cases). The runner counts an alternative as correct and reports it.
 */
import { z } from 'zod';

export const EVAL_CATEGORIES = ['cleaning', 'bike_repair', 'assembly', 'delivery', 'other'] as const;
export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

export const DECISION_OUTCOMES = ['APPROVED', 'PARTIAL', 'REJECTED', 'HUMAN_REVIEW'] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

export const CRITERION_VERDICTS = ['PASS', 'FAIL', 'UNCERTAIN', 'NOT_VISIBLE'] as const;
export type CriterionVerdict = (typeof CRITERION_VERDICTS)[number];

/** Money values in `case.json` are decimal strings, e.g. `"40.00"`. */
export const MONEY_VALUE_PATTERN = /^\d+\.\d{2}$/;

/** `eval/pairs/<NN>-<slug>` folder names. */
export const CASE_DIR_PATTERN = /^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Image file names the pipeline and the runner pick up. */
export const CASE_IMAGE_PATTERN = /^(before|after)_[A-Za-z0-9._-]+\.(jpe?g|png|webp)$/i;

export const EvalMoneySchema = z.object({
  currency: z.literal('USD'),
  value: z.string().regex(MONEY_VALUE_PATTERN, 'amount.value must be a decimal string like "40.00"'),
});

export const EvalCriterionSchema = z.object({
  id: z.string().regex(/^c\d+$/, 'criterion id must look like c1, c2, ... (cL is appended by the pipeline)'),
  label: z.string().min(8),
  required: z.boolean(),
  weight: z.number().gt(0).lte(1),
  howToVerify: z.string().min(8).optional(),
});

export const EvalCaseExpectedSchema = z.object({
  outcome: z.enum(DECISION_OUTCOMES),
  /** Other outcomes that also count as correct, documented in `notes`. */
  alternatives: z.array(z.enum(DECISION_OUTCOMES)).default([]),
  /** Expected verdict per criterion id, including `cL`. */
  criteria: z.record(z.string(), z.enum(CRITERION_VERDICTS)).default({}),
});

export const EvalCaseSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  category: z.enum(EVAL_CATEGORIES),
  amount: EvalMoneySchema,
  livenessCode: z.string().regex(/^\d{4}$/, 'livenessCode must be exactly 4 digits'),
  criteria: z.array(EvalCriterionSchema).min(2).max(6).optional(),
  expected: EvalCaseExpectedSchema,
  notes: z.string().default(''),
  /** Flip to true only when before_*/after_* photos exist for this case. */
  ready: z.boolean().default(false),
  /** DateTimeOriginal of the after photo, recorded by eval:validate before EXIF is stripped. */
  exifTakenAt: z.string().nullable().default(null),
});

export type EvalMoney = z.infer<typeof EvalMoneySchema>;
export type EvalCriterion = z.infer<typeof EvalCriterionSchema>;
export type EvalCaseExpected = z.infer<typeof EvalCaseExpectedSchema>;
export type EvalCase = z.infer<typeof EvalCaseSchema>;

/** Parse a `case.json` object; throws a compact, readable error listing every issue. */
export function parseEvalCase(raw: unknown): EvalCase {
  const result = EvalCaseSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(details);
  }
  return result.data;
}

/** `"40.00"` -> `4000` (integer cents; never float maths). */
export function moneyValueToCents(value: string): number {
  const [whole, fraction = '0'] = value.split('.');
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(`${fraction}00`.slice(0, 2), 10);
}
