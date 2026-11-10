import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Criterion, VerificationReport } from '@/shared/contracts';

vi.mock('server-only', () => ({}));

import { buildMockVerificationReport, mockBoxForIndex, sha256Of } from '@/server/vision/mock';
import { decide } from '@/server/vision/decide';
import { syntheticImage } from '../../fixtures/synthetic';


// Image-heavy tests spin up sharp/jpeg encoders; under the full suite's parallel
// workers the default 5 s per-test budget is too tight on CI.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const THRESHOLDS = {
  tPass: 0.9,
  tPartial: 0.5,
  tConf: 0.75,
  tLowConf: 0.6,
  partialRoundTo: 0.05,
};

const criterion = (id: string, weight: number, required = false): Criterion => ({
  id,
  label: `Criterion ${id}`,
  howToVerify: 'Look.',
  required,
  weight,
  phase: 'after',
  source: 'llm',
});

const bikeCriteria = [
  criterion('c1', 0.35, true),
  criterion('c2', 0.25, true),
  criterion('c3', 0.2),
  criterion('c4', 0.2),
  criterion('cL', 0, true),
];

const cleaningCriteria = [
  criterion('c1', 0.2, true),
  criterion('c2', 0.2),
  criterion('c3', 0.2, true),
  criterion('c4', 0.2),
  criterion('c5', 0.2, true),
  criterion('cL', 0, true),
];

const deliveryCriteria = [
  criterion('c1', 0.4, true),
  criterion('c2', 0.4, true),
  criterion('c3', 0.2),
  criterion('cL', 0, true),
];

describe('buildMockVerificationReport (contract C6)', () => {
  it('builds a deterministic all-PASS report for the job’s actual criteria', async () => {
    const report = await buildMockVerificationReport({
      criteria: bikeCriteria,
      category: 'bike_repair',
      livenessCode: '4821',
      firstAfterSha256: null,
      fixturesDir: path.join(process.cwd(), 'data', 'no-such-fixtures'),
    });

    expect(report.verdicts).toHaveLength(bikeCriteria.length);
    for (const [index, verdict] of report.verdicts.entries()) {
      expect(verdict.criterionId).toBe(bikeCriteria[index].id);
      expect(verdict.verdict).toBe('PASS');
      expect(verdict.confidence).toBe(0.95);
      expect(verdict.evidence[0].imageId).toBe('A1');
      expect(verdict.evidence[0].box_2d).toEqual(mockBoxForIndex(index));
    }
    expect(report.sameScene).toEqual({
      verdict: 'SAME',
      confidence: 0.9,
      rationale: expect.any(String),
    });
    expect(report.imageQualityIssues).toEqual(['NONE']);
    expect(report.livenessCode).toEqual({ found: true, readValue: '4821', imageId: 'A1' });
    expect(report.summary.length).toBeGreaterThan(0);
  });

  it('is deterministic (identical input -> identical output)', async () => {
    const input = {
      criteria: deliveryCriteria,
      category: 'delivery',
      livenessCode: '7712',
      firstAfterSha256: null,
      fixturesDir: path.join(process.cwd(), 'data', 'no-such-fixtures'),
    };
    const first = await buildMockVerificationReport(input);
    const second = await buildMockVerificationReport(input);
    expect(first).toEqual(second);
  });

  it('fails c4 with confidence 0.88 for cleaning jobs and keeps the rest PASS', async () => {
    const report = await buildMockVerificationReport({
      criteria: cleaningCriteria,
      category: 'cleaning',
      livenessCode: '5555',
      fixturesDir: path.join(process.cwd(), 'data', 'no-such-fixtures'),
    });
    const c4 = report.verdicts.find((verdict) => verdict.criterionId === 'c4');
    expect(c4?.verdict).toBe('FAIL');
    expect(c4?.confidence).toBe(0.88);
    expect(c4?.rationale).toBe('Grease is still visible on the oven interior.');
    expect(c4?.evidence).toHaveLength(1);
    expect(report.verdicts.filter((verdict) => verdict.verdict === 'PASS')).toHaveLength(
      cleaningCriteria.length - 1,
    );
  });

  it('echoes the job’s real liveness code, whatever it is', async () => {
    const report = await buildMockVerificationReport({
      criteria: [criterion('cL', 0, true)],
      category: 'other',
      livenessCode: '0420',
      fixturesDir: path.join(process.cwd(), 'data', 'no-such-fixtures'),
    });
    expect(report.livenessCode).toEqual({ found: true, readValue: '0420', imageId: 'A1' });
    expect(report.verdicts.find((verdict) => verdict.criterionId === 'cL')?.verdict).toBe('PASS');
  });
});

describe('mock + decide integration (contract C6 expected outcomes)', () => {
  it('bike_repair -> APPROVED with full capture of $60.00', async () => {
    const criteria = bikeCriteria;
    const report = await buildMockVerificationReport({
      criteria,
      category: 'bike_repair',
      livenessCode: '4821',
      fixturesDir: path.join(process.cwd(), 'data', 'no-such-fixtures'),
    });
    const decision = decide({
      criteria,
      report,
      forensics: { flags: [] },
      amountCents: 6000,
      currency: 'USD',
      thresholds: THRESHOLDS,
    });
    expect(decision.outcome).toBe('APPROVED');
    expect(decision.captureAmount?.value).toBe('60.00');
  });

  it('cleaning -> PARTIAL with 80% capture ($96.00 of $120.00)', async () => {
    const criteria = cleaningCriteria;
    const report = await buildMockVerificationReport({
      criteria,
      category: 'cleaning',
      livenessCode: '5555',
      fixturesDir: path.join(process.cwd(), 'data', 'no-such-fixtures'),
    });
    const decision = decide({
      criteria,
      report,
      forensics: { flags: [] },
      amountCents: 12000,
      currency: 'USD',
      thresholds: THRESHOLDS,
    });
    expect(decision.outcome).toBe('PARTIAL');
    expect(decision.captureAmount?.value).toBe('96.00');
    expect(decision.score).toBeCloseTo(0.8, 6);
  });

  it('delivery -> APPROVED with full capture of $45.00', async () => {
    const criteria = deliveryCriteria;
    const report = await buildMockVerificationReport({
      criteria,
      category: 'delivery',
      livenessCode: '3311',
      fixturesDir: path.join(process.cwd(), 'data', 'no-such-fixtures'),
    });
    const decision = decide({
      criteria,
      report,
      forensics: { flags: [] },
      amountCents: 4500,
      currency: 'USD',
      thresholds: THRESHOLDS,
    });
    expect(decision.outcome).toBe('APPROVED');
    expect(decision.captureAmount?.value).toBe('45.00');
  });
});

describe('recorded fixtures', () => {
  let fixturesDir: string;

  beforeAll(async () => {
    await mkdir(path.join(process.cwd(), 'data'), { recursive: true });
    fixturesDir = await mkdtemp(path.join(process.cwd(), 'data', 'fixtures-test-'));
  });

  afterAll(async () => {
    await rm(fixturesDir, { recursive: true, force: true });
  });

  it('returns the recorded fixture named by the first after image sha256', async () => {
    const after = await syntheticImage(42);
    const digest = sha256Of(after);
    const recorded: VerificationReport = {
      verdicts: [
        { criterionId: 'c1', verdict: 'FAIL', confidence: 0.97, rationale: 'Recorded fail.', evidence: [] },
        { criterionId: 'cL', verdict: 'PASS', confidence: 0.99, rationale: 'Recorded code.', evidence: [] },
      ],
      sameScene: { verdict: 'SAME', confidence: 0.9, rationale: 'Recorded same scene.' },
      livenessCode: { found: true, readValue: '4821', imageId: 'A1' },
      imageQualityIssues: ['NONE'],
      summary: 'Recorded fixture from a real model run.',
    };
    await writeFile(path.join(fixturesDir, `${digest}.json`), JSON.stringify(recorded), 'utf8');

    const report = await buildMockVerificationReport({
      criteria: [criterion('c1', 1, true), criterion('cL', 0, true)],
      category: 'other',
      livenessCode: '4821',
      firstAfterSha256: digest,
      fixturesDir,
    });
    expect(report).toEqual(recorded);
  });

  it('falls back to the deterministic report when the fixture is invalid', async () => {
    const digest = 'a'.repeat(64);
    await writeFile(path.join(fixturesDir, `${digest}.json`), '{not valid json', 'utf8');
    const report = await buildMockVerificationReport({
      criteria: [criterion('c1', 1, true)],
      category: 'other',
      livenessCode: '4821',
      firstAfterSha256: digest,
      fixturesDir,
    });
    expect(report.verdicts[0].verdict).toBe('PASS');
  });
});
