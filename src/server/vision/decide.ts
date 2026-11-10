import type {
  Criterion,
  Decision,
  ForensicsReport,
  Money,
  VerificationReport,
} from '@/shared/contracts';
import { floorToStep, fromCents } from '@/shared/money';

/**
 * Decision-engine thresholds. Passed in by the caller (the orchestrator reads them
 * from `getThresholds()` in src/server/env.ts) so this module stays pure and testable.
 *
 * Defaults from docs/MANUAL.md §9.4:
 *   tPass 0.9 · tPartial 0.5 · tConf 0.75 · tLowConf 0.6 · partialRoundTo 0.05
 */
export type DecisionThresholds = {
  tPass: number;
  tPartial: number;
  tConf: number;
  tLowConf: number;
  partialRoundTo: number;
};

export type DecideInput = {
  criteria: Criterion[];
  report: VerificationReport;
  forensics: ForensicsReport;
  /** Job amount in integer minor units (cents). */
  amountCents: number;
  /** ISO-4217 currency code, e.g. "USD". */
  currency: string;
  thresholds: DecisionThresholds;
};

type ForensicsFlag = ForensicsReport['flags'][number];
type CriterionVerdict = VerificationReport['verdicts'][number];

/** Ratios are compared in integer thousandths so that 0.2 + 0.2 + 0.2 + 0.2 is exactly 800. */
const toThousandths = (ratio: number): number => Math.round(ratio * 1000);

const formatRatio = (thousandths: number): string => (thousandths / 1000).toFixed(3);

const formatCents = (cents: number): string => fromCents(cents);

/**
 * Pure decision engine — implements docs/MANUAL.md §9.4 exactly, in order:
 *
 *   1. any HIGH forensics flag                                  -> HUMAN_REVIEW
 *   2. any required criterion FAIL with confidence >= T_CONF    -> REJECTED
 *   3. any required criterion UNCERTAIN/NOT_VISIBLE, or any
 *      criterion with confidence < T_LOW_CONF                   -> HUMAN_REVIEW
 *   4. score >= T_PASS and no MEDIUM flag                       -> APPROVED (100 %)
 *   5. score >= T_PARTIAL                                       -> PARTIAL (floor to PARTIAL_ROUND_TO)
 *   6. otherwise                                                -> REJECTED
 *
 * `score` is the weight sum of criteria that PASS with confidence >= T_LOW_CONF,
 * accumulated in integer thousandths. A criterion with no verdict from the VLM is
 * treated as NOT_VISIBLE with confidence 0. The capture amount can never exceed the
 * authorized amount and is always returned as integer cents wrapped in `Money`.
 */
export function decide({
  criteria,
  report,
  forensics,
  amountCents,
  currency,
  thresholds,
}: DecideInput): Decision {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error(`decide: amountCents must be a non-negative integer, got ${amountCents}`);
  }

  const tPass = toThousandths(thresholds.tPass);
  const tPartial = toThousandths(thresholds.tPartial);
  const tConf = toThousandths(thresholds.tConf);
  const tLowConf = toThousandths(thresholds.tLowConf);

  const flags: ForensicsFlag[] = forensics.flags ?? [];
  const highFlags = flags.filter((flag) => flag.level === 'HIGH');
  const mediumFlags = flags.filter((flag) => flag.level === 'MEDIUM');

  const verdicts = new Map<string, CriterionVerdict>(
    report.verdicts.map((verdict) => [verdict.criterionId, verdict] as const),
  );

  /** Missing verdicts count as NOT_VISIBLE with confidence 0 (never PASS). */
  const verdictFor = (criterion: Criterion): CriterionVerdict =>
    verdicts.get(criterion.id) ?? {
      criterionId: criterion.id,
      verdict: 'NOT_VISIBLE',
      confidence: 0,
      rationale: 'No verdict was returned for this criterion.',
      evidence: [],
    };

  const reasons: string[] = [];

  // Score in integer thousandths: weight of every criterion that PASSes confidently enough.
  let scoreThousandths = 0;
  for (const criterion of criteria) {
    const verdict = verdictFor(criterion);
    if (verdict.verdict === 'PASS' && toThousandths(verdict.confidence) >= tLowConf) {
      scoreThousandths += toThousandths(criterion.weight);
    }
  }
  const score = scoreThousandths / 1000;

  const build = (outcome: Decision['outcome'], captureCents?: number): Decision => {
    const decision: Decision = { outcome, score, reasons };
    if (captureCents !== undefined) {
      const clamped = Math.max(0, Math.min(amountCents, Math.round(captureCents)));
      const captureAmount: Money = { currency, value: fromCents(clamped) };
      decision.captureAmount = captureAmount;
    }
    return decision;
  };

  const confidenceReason = (criterion: Criterion, verdict: CriterionVerdict): string =>
    `Criterion ${criterion.id} (${criterion.label}) is ${verdict.verdict} with confidence ${verdict.confidence.toFixed(2)}`;

  // (1) A HIGH forensics flag always wins: suspicious evidence never moves money automatically.
  if (highFlags.length > 0) {
    for (const flag of highFlags) {
      reasons.push(`HIGH forensics flag ${flag.code}: ${flag.message}`);
    }
    return build('HUMAN_REVIEW');
  }

  // (2) A required criterion confidently FAILED => the job was not done.
  const confidentRequiredFails = criteria.filter((criterion) => {
    if (!criterion.required) return false;
    const verdict = verdictFor(criterion);
    return verdict.verdict === 'FAIL' && toThousandths(verdict.confidence) >= tConf;
  });
  if (confidentRequiredFails.length > 0) {
    for (const criterion of confidentRequiredFails) {
      const verdict = verdictFor(criterion);
      reasons.push(
        `Required criterion ${criterion.id} FAILED (confidence ${verdict.confidence.toFixed(2)} >= T_CONF ${formatRatio(tConf)}): ${verdict.rationale}`,
      );
    }
    return build('REJECTED');
  }

  // (3) Anything the model could not judge, or judged with low confidence, needs a human.
  const uncertainRequired = criteria.filter((criterion) => {
    if (!criterion.required) return false;
    const verdict = verdictFor(criterion);
    return verdict.verdict === 'UNCERTAIN' || verdict.verdict === 'NOT_VISIBLE';
  });
  const lowConfidence = criteria.filter(
    (criterion) => toThousandths(verdictFor(criterion).confidence) < tLowConf,
  );
  if (uncertainRequired.length > 0 || lowConfidence.length > 0) {
    for (const criterion of uncertainRequired) {
      reasons.push(`Required ${confidenceReason(criterion, verdictFor(criterion))} — a human must review.`);
    }
    for (const criterion of lowConfidence) {
      const verdict = verdictFor(criterion);
      reasons.push(
        `${confidenceReason(criterion, verdict)} is below T_LOW_CONF ${formatRatio(tLowConf)} — a human must review.`,
      );
    }
    return build('HUMAN_REVIEW');
  }

  // (4) Clean pass: full capture is allowed.
  if (scoreThousandths >= tPass && mediumFlags.length === 0) {
    const passed = criteria.filter((criterion) => verdictFor(criterion).verdict === 'PASS').length;
    reasons.push(
      `Score ${formatRatio(scoreThousandths)} >= T_PASS ${formatRatio(tPass)}; ${passed}/${criteria.length} criteria passed and no MEDIUM forensics flags. Capturing the full amount.`,
    );
    return build('APPROVED', amountCents);
  }

  // (5) Partial work => propose a partial capture, floored to PARTIAL_ROUND_TO.
  if (scoreThousandths >= tPartial) {
    const captureCents = Math.min(
      amountCents,
      floorToStep(amountCents, score, thresholds.partialRoundTo),
    );
    reasons.push(
      `Score ${formatRatio(scoreThousandths)} is below T_PASS ${formatRatio(tPass)}; proposing a partial capture of ${formatCents(captureCents)} ${currency}.`,
    );
    for (const flag of mediumFlags) {
      reasons.push(`MEDIUM forensics flag ${flag.code}: ${flag.message} — full approval blocked until the customer accepts.`);
    }
    for (const criterion of criteria) {
      const verdict = verdictFor(criterion);
      if (verdict.verdict !== 'PASS') {
        reasons.push(`Criterion ${criterion.id} did not pass (${verdict.verdict}, confidence ${verdict.confidence.toFixed(2)}).`);
      }
    }
    return build('PARTIAL', captureCents);
  }

  // (6) Too little of the work is verifiably done.
  reasons.push(
    `Score ${formatRatio(scoreThousandths)} is below T_PARTIAL ${formatRatio(tPartial)} — the work is not sufficiently verified.`,
  );
  for (const criterion of criteria) {
    const verdict = verdictFor(criterion);
    if (verdict.verdict !== 'PASS') {
      reasons.push(`Criterion ${criterion.id} did not pass (${verdict.verdict}, confidence ${verdict.confidence.toFixed(2)}).`);
    }
  }
  return build('REJECTED');
}
