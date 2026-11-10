import { describe, expect, it } from 'vitest';
import type { Criterion, ForensicsReport, VerificationReport } from '@/shared/contracts';
import { decide, type DecisionThresholds } from '@/server/vision/decide';

/**
 * Table-driven tests for the pure decision engine (docs/MANUAL.md §9.4).
 *
 * >= 12 cases required by the acceptance criteria; this file has 20 and covers:
 * liveness missing, HIGH/MEDIUM forensics flags, required failures, low confidence,
 * partial rounding (floor to 0.05), the 0.2+0.2+0.2+0.2 float trap, thresholds,
 * a 1-cent job, missing verdicts and the reason strings.
 */

const THRESHOLDS: DecisionThresholds = {
  tPass: 0.9,
  tPartial: 0.5,
  tConf: 0.75,
  tLowConf: 0.6,
  partialRoundTo: 0.05,
};

function criterion(
  id: string,
  weight: number,
  required = false,
  label = `Criterion ${id}`,
): Criterion {
  return {
    id,
    label,
    howToVerify: 'Look at the photo.',
    required,
    weight,
    phase: 'after',
    source: 'llm',
  };
}

type VerdictInput = {
  criterionId: string;
  verdict: 'PASS' | 'FAIL' | 'UNCERTAIN' | 'NOT_VISIBLE';
  confidence: number;
  rationale?: string;
};

function report(verdicts: VerdictInput[]): VerificationReport {
  return {
    verdicts: verdicts.map((verdict) => ({
      criterionId: verdict.criterionId,
      verdict: verdict.verdict,
      confidence: verdict.confidence,
      rationale: verdict.rationale ?? `${verdict.criterionId} is ${verdict.verdict}`,
      evidence: [],
    })),
    sameScene: { verdict: 'SAME', confidence: 0.9, rationale: 'Same place.' },
    livenessCode: { found: true, readValue: '4821', imageId: 'A1' },
    imageQualityIssues: ['NONE'],
    summary: 'Unit-test report.',
  };
}

function forensics(flags: Array<{ code: string; level: 'HIGH' | 'MEDIUM' | 'INFO' }> = []): ForensicsReport {
  return {
    flags: flags.map((flag) => ({
      code: flag.code as ForensicsReport['flags'][number]['code'],
      level: flag.level,
      message: `${flag.code} flag message`,
      evidenceIds: [],
    })),
  };
}

const pass = (id: string, confidence = 0.95): VerdictInput => ({ criterionId: id, verdict: 'PASS', confidence });
const fail = (id: string, confidence: number): VerdictInput => ({ criterionId: id, verdict: 'FAIL', confidence });
const uncertain = (id: string, confidence: number): VerdictInput => ({
  criterionId: id,
  verdict: 'UNCERTAIN',
  confidence,
});
const notVisible = (id: string): VerdictInput => ({ criterionId: id, verdict: 'NOT_VISIBLE', confidence: 0 });

/** Five-criteria cleaning-style job: c4 is the optional "oven interior" criterion. */
const cleaningCriteria = [
  criterion('c1', 0.2, true),
  criterion('c2', 0.2, false),
  criterion('c3', 0.2, true),
  criterion('c4', 0.2, false),
  criterion('c5', 0.2, true),
];

type Case = {
  name: string;
  criteria: Criterion[];
  report: VerificationReport;
  forensics?: ForensicsReport;
  amountCents?: number;
  thresholds?: Partial<DecisionThresholds>;
  expected: { outcome: string; captureValue?: string; score?: number };
};

const cases: Case[] = [
  {
    name: 'all required criteria pass -> APPROVED with full capture',
    criteria: [criterion('c1', 0.5, true), criterion('c2', 0.5, true), criterion('cL', 0, true)],
    report: report([pass('c1'), pass('c2'), pass('cL')]),
    amountCents: 6000,
    expected: { outcome: 'APPROVED', captureValue: '60.00', score: 1 },
  },
  {
    name: '4 of 5 cleaning criteria pass -> PARTIAL capture of 80% ($96 of $120)',
    criteria: cleaningCriteria,
    report: report([
      pass('c1'),
      pass('c2'),
      pass('c3'),
      fail('c4', 0.88),
      pass('c5'),
    ]),
    amountCents: 12000,
    expected: { outcome: 'PARTIAL', captureValue: '96.00', score: 0.8 },
  },
  {
    name: 'required criterion FAIL with high confidence -> REJECTED',
    criteria: cleaningCriteria,
    report: report([pass('c1'), pass('c2'), fail('c3', 0.92), pass('c4'), pass('c5')]),
    amountCents: 12000,
    expected: { outcome: 'REJECTED' },
  },
  {
    name: 'required criterion FAIL with low confidence -> HUMAN_REVIEW (not REJECTED)',
    criteria: cleaningCriteria,
    report: report([pass('c1'), pass('c2'), fail('c3', 0.5), pass('c4'), pass('c5')]),
    amountCents: 12000,
    expected: { outcome: 'HUMAN_REVIEW' },
  },
  {
    name: 'liveness code missing (NOT_VISIBLE) -> HUMAN_REVIEW',
    criteria: [criterion('c1', 0.6, true), criterion('cL', 0, true)],
    report: report([pass('c1'), notVisible('cL')]),
    amountCents: 6000,
    expected: { outcome: 'HUMAN_REVIEW' },
  },
  {
    name: 'liveness code wrong with high confidence -> REJECTED',
    criteria: [criterion('c1', 0.6, true), criterion('cL', 0, true)],
    report: report([pass('c1'), fail('cL', 0.9)]),
    amountCents: 6000,
    expected: { outcome: 'REJECTED' },
  },
  {
    name: 'required verdict missing from the report entirely -> HUMAN_REVIEW',
    criteria: [criterion('c1', 0.5, true), criterion('c2', 0.5, true)],
    report: report([pass('c1')]),
    amountCents: 6000,
    expected: { outcome: 'HUMAN_REVIEW' },
  },
  {
    name: 'HIGH forensics flag overrides an otherwise perfect report -> HUMAN_REVIEW',
    criteria: [criterion('c1', 1, true)],
    report: report([pass('c1')]),
    forensics: forensics([{ code: 'NEAR_DUPLICATE', level: 'HIGH' }]),
    amountCents: 6000,
    expected: { outcome: 'HUMAN_REVIEW', score: 1 },
  },
  {
    name: 'HIGH EXACT_DUPLICATE with all criteria failing -> HUMAN_REVIEW (flag wins first)',
    criteria: [criterion('c1', 1, true)],
    report: report([fail('c1', 0.99)]),
    forensics: forensics([{ code: 'EXACT_DUPLICATE', level: 'HIGH' }]),
    amountCents: 6000,
    expected: { outcome: 'HUMAN_REVIEW' },
  },
  {
    name: 'MEDIUM forensics flag blocks APPROVED -> PARTIAL with a customer approval step',
    criteria: [criterion('c1', 1, true)],
    report: report([pass('c1')]),
    forensics: forensics([{ code: 'NO_CHANGE', level: 'MEDIUM' }]),
    amountCents: 6000,
    expected: { outcome: 'PARTIAL', captureValue: '60.00', score: 1 },
  },
  {
    name: 'INFO forensics flag does not block approval',
    criteria: [criterion('c1', 1, true)],
    report: report([pass('c1')]),
    forensics: forensics([{ code: 'EXIF_MISSING', level: 'INFO' }]),
    amountCents: 6000,
    expected: { outcome: 'APPROVED', captureValue: '60.00' },
  },
  {
    name: 'non-required criterion PASS with low confidence -> HUMAN_REVIEW',
    criteria: [criterion('c1', 0.5, true), criterion('c2', 0.5, false)],
    report: report([pass('c1'), pass('c2', 0.5)]),
    amountCents: 6000,
    expected: { outcome: 'HUMAN_REVIEW' },
  },
  {
    name: 'required criterion UNCERTAIN with high confidence -> HUMAN_REVIEW',
    criteria: [criterion('c1', 1, true)],
    report: report([uncertain('c1', 0.9)]),
    amountCents: 6000,
    expected: { outcome: 'HUMAN_REVIEW' },
  },
  {
    name: 'score below T_PARTIAL -> REJECTED',
    criteria: [
      criterion('c1', 0.4, true),
      criterion('c2', 0.2, false),
      criterion('c3', 0.2, false),
      criterion('c4', 0.2, false),
    ],
    report: report([pass('c1'), fail('c2', 0.8), fail('c3', 0.8), fail('c4', 0.8)]),
    amountCents: 12000,
    expected: { outcome: 'REJECTED', score: 0.4 },
  },
  {
    name: '0.2 + 0.2 + 0.2 + 0.2 float trap -> score exactly 0.8 and $96 of $120',
    criteria: [criterion('c1', 0.2), criterion('c2', 0.2), criterion('c3', 0.2), criterion('c4', 0.2)],
    report: report([pass('c1'), pass('c2'), pass('c3'), pass('c4')]),
    amountCents: 12000,
    expected: { outcome: 'PARTIAL', captureValue: '96.00', score: 0.8 },
  },
  {
    name: 'partial rounding: score 0.849 floors to 0.80 -> $80.00 of $100',
    criteria: [criterion('c1', 0.849, true), criterion('c2', 0.151, false)],
    report: report([pass('c1'), fail('c2', 0.8)]),
    amountCents: 10000,
    expected: { outcome: 'PARTIAL', captureValue: '80.00' },
  },
  {
    name: 'partial rounding: score 0.85 stays 0.85 -> $85.00 of $100',
    criteria: [criterion('c1', 0.85, true), criterion('c2', 0.15, false)],
    report: report([pass('c1'), fail('c2', 0.8)]),
    amountCents: 10000,
    expected: { outcome: 'PARTIAL', captureValue: '85.00' },
  },
  {
    name: 'score exactly T_PASS 0.9 -> APPROVED',
    criteria: [criterion('c1', 0.9, true), criterion('c2', 0.1, false)],
    report: report([pass('c1'), fail('c2', 0.8)]),
    amountCents: 10000,
    expected: { outcome: 'APPROVED', captureValue: '100.00', score: 0.9 },
  },
  {
    name: 'custom thresholds: T_PASS 0.8 turns a 0.85 score into APPROVED',
    criteria: [criterion('c1', 0.85, true), criterion('c2', 0.15, false)],
    report: report([pass('c1'), fail('c2', 0.8)]),
    amountCents: 10000,
    thresholds: { tPass: 0.8 },
    expected: { outcome: 'APPROVED', captureValue: '100.00' },
  },
  {
    name: 'a 1-cent job can be fully captured',
    criteria: [criterion('c1', 1, true)],
    report: report([pass('c1')]),
    amountCents: 1,
    expected: { outcome: 'APPROVED', captureValue: '0.01' },
  },
];

describe('decide (decision engine, MANUAL §9.4)', () => {
  it.each(cases)('$name', ({ criteria, report: verificationReport, forensics: forensicsReport, amountCents, thresholds, expected }) => {
    const decision = decide({
      criteria,
      report: verificationReport,
      forensics: forensicsReport ?? forensics(),
      amountCents: amountCents ?? 6000,
      currency: 'USD',
      thresholds: { ...THRESHOLDS, ...thresholds },
    });

    expect(decision.outcome).toBe(expected.outcome);
    if (expected.captureValue !== undefined) {
      expect(decision.captureAmount).toBeDefined();
      expect(decision.captureAmount?.currency).toBe('USD');
      expect(decision.captureAmount?.value).toBe(expected.captureValue);
    } else {
      expect(decision.captureAmount).toBeUndefined();
    }
    if (expected.score !== undefined) {
      expect(decision.score).toBeCloseTo(expected.score, 6);
    }
    expect(Array.isArray(decision.reasons)).toBe(true);
    expect(decision.reasons.length).toBeGreaterThan(0);
  });

  it('never captures more than the authorized amount', () => {
    const decision = decide({
      criteria: [criterion('c1', 1, true)],
      report: report([pass('c1')]),
      forensics: forensics([{ code: 'NO_CHANGE', level: 'MEDIUM' }]),
      amountCents: 5000,
      currency: 'USD',
      thresholds: THRESHOLDS,
    });
    expect(decision.outcome).toBe('PARTIAL');
    expect(Number(decision.captureAmount?.value)).toBeLessThanOrEqual(50);
  });

  it('reasons cite criterion ids and forensics flag codes', () => {
    const highFlag = decide({
      criteria: [criterion('c1', 1, true)],
      report: report([pass('c1')]),
      forensics: forensics([{ code: 'NEAR_DUPLICATE', level: 'HIGH' }]),
      amountCents: 5000,
      currency: 'USD',
      thresholds: THRESHOLDS,
    });
    expect(highFlag.reasons.join(' ')).toContain('NEAR_DUPLICATE');

    const rejected = decide({
      criteria: [criterion('c7', 1, true)],
      report: report([fail('c7', 0.95)]),
      forensics: forensics(),
      amountCents: 5000,
      currency: 'USD',
      thresholds: THRESHOLDS,
    });
    expect(rejected.reasons.join(' ')).toContain('c7');
  });

  it('is deterministic for identical inputs', () => {
    const input = {
      criteria: cleaningCriteria,
      report: report([pass('c1'), pass('c2'), pass('c3'), fail('c4', 0.88), pass('c5')]),
      forensics: forensics(),
      amountCents: 12000,
      currency: 'USD',
      thresholds: THRESHOLDS,
    };
    expect(decide(input)).toEqual(decide(input));
  });

  it('rejects a non-integer amount (money must be integer cents)', () => {
    expect(() =>
      decide({
        criteria: [criterion('c1', 1, true)],
        report: report([pass('c1')]),
        forensics: forensics(),
        amountCents: 12.5,
        currency: 'USD',
        thresholds: THRESHOLDS,
      }),
    ).toThrow(/integer/i);
  });
});
