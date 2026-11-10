import { describe, expect, it, vi } from 'vitest';
import type { Criterion, VerificationReport } from '@/shared/contracts';

const aiMock = vi.hoisted(() => ({ generateObject: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('ai', () => ({ generateObject: aiMock.generateObject }));

import {
  buildVerificationContent,
  normalizeReport,
  verifyEvidence,
  VlmInvalidOutput,
} from '@/server/vision/verify';
import { VERIFY_SYSTEM_PROMPT } from '@/server/vision/prompts';
import { syntheticImage } from '../../fixtures/synthetic';


// Image-heavy tests spin up sharp/jpeg encoders; under the full suite's parallel
// workers the default 5 s per-test budget is too tight on CI.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const CRITERIA: Criterion[] = [
  {
    id: 'c1',
    label: 'Chain is clean',
    howToVerify: 'Look at the chain.',
    required: true,
    weight: 0.5,
    phase: 'after',
    source: 'llm',
  },
  {
    id: 'cL',
    label: 'Liveness code {CODE} visible',
    howToVerify: 'Read the code.',
    required: true,
    weight: 0,
    phase: 'after',
    source: 'system',
  },
];

const VALID_REPORT: VerificationReport = {
  verdicts: [
    { criterionId: 'c1', verdict: 'PASS', confidence: 0.93, rationale: 'Chain looks new.', evidence: [] },
    { criterionId: 'cL', verdict: 'PASS', confidence: 0.99, rationale: 'Code 4821 readable.', evidence: [] },
  ],
  sameScene: { verdict: 'SAME', confidence: 0.9, rationale: 'Same bike.' },
  livenessCode: { found: true, readValue: '4821', imageId: 'A1' },
  imageQualityIssues: ['NONE'],
  summary: 'Looks good.',
};

describe('normalizeReport (post-validation)', () => {
  it('adds NOT_VISIBLE verdicts for criteria the model skipped', () => {
    const normalized = normalizeReport(
      {
        ...VALID_REPORT,
        verdicts: VALID_REPORT.verdicts.filter((verdict) => verdict.criterionId !== 'cL'),
      },
      CRITERIA,
      ['A1'],
    );
    const liveness = normalized.verdicts.find((verdict) => verdict.criterionId === 'cL');
    expect(liveness).toEqual({
      criterionId: 'cL',
      verdict: 'NOT_VISIBLE',
      confidence: 0,
      rationale: expect.any(String),
      evidence: [],
    });
  });

  it('drops unknown criterion ids and duplicate verdicts', () => {
    const normalized = normalizeReport(
      {
        ...VALID_REPORT,
        verdicts: [
          ...VALID_REPORT.verdicts,
          { criterionId: 'c1', verdict: 'FAIL', confidence: 0.5, rationale: 'dup', evidence: [] },
          { criterionId: 'nope', verdict: 'PASS', confidence: 0.9, rationale: 'unknown', evidence: [] },
        ],
      },
      CRITERIA,
      ['A1'],
    );
    expect(normalized.verdicts.map((verdict) => verdict.criterionId).sort()).toEqual(['c1', 'cL']);
    expect(normalized.verdicts.filter((verdict) => verdict.criterionId === 'c1')).toHaveLength(1);
  });

  it('clamps box coordinates, confidence and drops boxes on unknown images', () => {
    const normalized = normalizeReport(
      {
        ...VALID_REPORT,
        verdicts: [
          {
            criterionId: 'c1',
            verdict: 'PASS',
            confidence: 1.4,
            rationale: 'x',
            evidence: [
              { imageId: 'A1', box_2d: [-20, 1000, 1200, 50], note: 'clamp me' },
              { imageId: 'B9', box_2d: [0, 0, 10, 10], note: 'unknown image' },
            ],
          },
        ],
      },
      CRITERIA,
      ['A1'],
    );
    const verdict = normalized.verdicts.find((item) => item.criterionId === 'c1');
    expect(verdict?.confidence).toBe(1);
    expect(verdict?.evidence).toHaveLength(1);
    expect(verdict?.evidence[0].box_2d).toEqual([0, 1000, 1000, 50]);
  });

  it('defaults empty imageQualityIssues to NONE and clears unknown liveness imageIds', () => {
    const normalized = normalizeReport(
      {
        ...VALID_REPORT,
        imageQualityIssues: [],
        livenessCode: { found: true, readValue: '4821', imageId: 'B9' },
      },
      CRITERIA,
      ['A1'],
    );
    expect(normalized.imageQualityIssues).toEqual(['NONE']);
    expect(normalized.livenessCode.imageId).toBeNull();
  });
});

describe('buildVerificationContent', () => {
  it('labels the images B1..Bn and A1..An in order', async () => {
    const content = buildVerificationContent({
      criteria: CRITERIA,
      before: [{ imageId: 'B1', buffer: await syntheticImage(1) }],
      after: [{ imageId: 'A1', buffer: await syntheticImage(2) }],
      livenessCode: '4821',
    });

    const textParts = content.filter((part) => part.type === 'text').map((part) => (part as { text: string }).text);
    expect(textParts[0]).toContain(VERIFY_SYSTEM_PROMPT);
    expect(textParts[0]).toContain('4821');
    expect(textParts).toContain('Image B1:');
    expect(textParts).toContain('Image A1:');
    // B1 label comes before A1 label.
    expect(textParts.indexOf('Image B1:')).toBeLessThan(textParts.indexOf('Image A1:'));
    expect(content.filter((part) => part.type === 'image')).toHaveLength(2);
  });
});

describe('verifyEvidence', () => {
  it('uses the deterministic mock when mock mode is on (no AI call)', async () => {
    aiMock.generateObject.mockReset();
    const report = await verifyEvidence({
      criteria: CRITERIA,
      before: [],
      after: [{ imageId: 'A1', buffer: await syntheticImage(3) }],
      livenessCode: '4821',
      category: 'bike_repair',
      mock: true,
    });
    expect(aiMock.generateObject).not.toHaveBeenCalled();
    expect(report.verdicts.every((verdict) => verdict.verdict === 'PASS')).toBe(true);
    expect(report.livenessCode.readValue).toBe('4821');
  });

  it('calls generateObject once with temperature 0 and a timeout for a normal run', async () => {
    aiMock.generateObject.mockReset();
    aiMock.generateObject.mockResolvedValue({ object: VALID_REPORT });
    const fakeModel = { modelId: 'test-model', provider: 'test' };
    const report = await verifyEvidence({
      criteria: CRITERIA,
      before: [{ imageId: 'B1', buffer: await syntheticImage(4) }],
      after: [{ imageId: 'A1', buffer: await syntheticImage(5) }],
      livenessCode: '4821',
      mock: false,
      model: fakeModel as never,
    });
    expect(aiMock.generateObject).toHaveBeenCalledTimes(1);
    const options = aiMock.generateObject.mock.calls[0][0];
    expect(options.temperature).toBe(0);
    expect(options.abortSignal).toBeDefined();
    expect(report.verdicts).toHaveLength(2);
  });

  it('retries once when the first output fails validation, then succeeds', async () => {
    aiMock.generateObject.mockReset();
    aiMock.generateObject.mockRejectedValueOnce(new Error('invalid JSON'));
    aiMock.generateObject.mockResolvedValueOnce({ object: VALID_REPORT });
    const fakeModel = { modelId: 'test-model', provider: 'test' };
    const report = await verifyEvidence({
      criteria: CRITERIA,
      before: [],
      after: [{ imageId: 'A1', buffer: await syntheticImage(6) }],
      livenessCode: '4821',
      mock: false,
      model: fakeModel as never,
    });
    expect(aiMock.generateObject).toHaveBeenCalledTimes(2);
    const retryMessages = aiMock.generateObject.mock.calls[1][0].messages;
    const retryText = JSON.stringify(retryMessages);
    expect(retryText).toContain('failed validation');
    expect(report.verdicts).toHaveLength(2);
  });

  it('throws VlmInvalidOutput after a second validation failure', async () => {
    aiMock.generateObject.mockReset();
    aiMock.generateObject.mockRejectedValue(new Error('still invalid'));
    const fakeModel = { modelId: 'test-model', provider: 'test' };
    await expect(
      verifyEvidence({
        criteria: CRITERIA,
        before: [],
        after: [{ imageId: 'A1', buffer: await syntheticImage(7) }],
        livenessCode: '4821',
        mock: false,
        model: fakeModel as never,
      }),
    ).rejects.toBeInstanceOf(VlmInvalidOutput);
    expect(aiMock.generateObject).toHaveBeenCalledTimes(2);
  });

  it('requires at least one after image', async () => {
    await expect(
      verifyEvidence({ criteria: CRITERIA, before: [], after: [], livenessCode: '4821', mock: true }),
    ).rejects.toThrow(/after image/i);
  });
});
