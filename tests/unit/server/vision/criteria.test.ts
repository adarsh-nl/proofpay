import { afterEach, describe, expect, it, vi } from 'vitest';

const aiMock = vi.hoisted(() => ({ generateObject: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('ai', () => ({ generateObject: aiMock.generateObject }));

import {
  CRITERIA_TIMEOUT_MS,
  fallbackCriteria,
  generateCriteria,
  normaliseDraftCriteria,
  normaliseWeights,
  type CriteriaDraftItem,
} from '@/server/vision/criteria';
import { CRITERIA_SYSTEM_PROMPT } from '@/server/vision/prompts';
import type { Criterion } from '@/shared/contracts';

/** Criteria-generator tests (MANUAL §9.1, contract C5). AI SDK is mocked; no network. */

const draftItem = (weight: number, required = false): CriteriaDraftItem => ({
  label: `Check something visible (${weight})`,
  howToVerify: 'Look at the photo and check it.',
  required,
  weight,
  phase: 'after',
});

const JOB = {
  title: 'Replace bike chain',
  description: 'The chain is rusty; replace it with a new one.',
  category: 'bike_repair' as const,
  amount: { currency: 'USD', value: '60.00' },
};

const sumThousandths = (criteria: Criterion[]): number =>
  criteria.reduce((sum, criterion) => sum + Math.round(criterion.weight * 1000), 0);

afterEach(() => {
  vi.unstubAllEnvs();
  aiMock.generateObject.mockReset();
});

describe('normaliseWeights', () => {
  it('turns arbitrary positive weights into exactly 1000 thousandths', () => {
    expect(normaliseWeights([0.5, 0.3, 0.2], [true, false, false])).toEqual([500, 300, 200]);
    expect(normaliseWeights([5, 3, 2], [false, false, false])).toEqual([500, 300, 200]);
    expect(normaliseWeights([0.2, 0.2, 0.2, 0.2, 0.2], [false, false, false, false, false])).toEqual([
      200, 200, 200, 200, 200,
    ]);
  });

  it('falls back to equal weights when the total is zero or garbage', () => {
    expect(normaliseWeights([0, 0, 0], [false, false, false])).toEqual([334, 333, 333]);
    expect(normaliseWeights([0.5, -1, Number.NaN], [false, false, false])).toEqual([1000, 0, 0]);
  });

  it('keeps required criteria at >= 10% by taking weight from optional ones', () => {
    expect(normaliseWeights([0.9, 0.05, 0.05], [false, true, true])).toEqual([800, 100, 100]);
  });

  it('handles a single criterion', () => {
    expect(normaliseWeights([0.5], [true])).toEqual([1000]);
  });
});

describe('normaliseDraftCriteria', () => {
  it('assigns c1..cN ids, normalises weights and appends cL last', () => {
    const criteria = normaliseDraftCriteria([
      draftItem(0.5, true),
      draftItem(0.3),
      draftItem(0.2),
    ]);

    expect(criteria.map((criterion) => criterion.id)).toEqual(['c1', 'c2', 'c3', 'cL']);
    expect(sumThousandths(criteria)).toBe(1000);
    expect(criteria[0].weight).toBe(0.5);
    expect(criteria[0].source).toBe('llm');
    expect(criteria[0].required).toBe(true);
    expect(criteria[0].phase).toBe('after');
  });

  it('always appends the system liveness criterion with the {CODE} placeholder', () => {
    const criteria = normaliseDraftCriteria([draftItem(0.5), draftItem(0.3), draftItem(0.2)]);
    const liveness = criteria[criteria.length - 1];
    expect(liveness.id).toBe('cL');
    expect(liveness.required).toBe(true);
    expect(liveness.weight).toBe(0);
    expect(liveness.source).toBe('system');
    expect(liveness.label).toContain('{CODE}');
  });

  it('respects the 3..6 bounds', () => {
    expect(() => normaliseDraftCriteria([draftItem(1), draftItem(1)])).toThrow(/3\.\.6/);
    expect(() =>
      normaliseDraftCriteria(Array.from({ length: 7 }, () => draftItem(0.1))),
    ).toThrow(/3\.\.6/);
  });
});

describe('generateCriteria', () => {
  it('returns the category template in mock mode without calling the AI', async () => {
    aiMock.generateObject.mockReset();
    const criteria = await generateCriteria(JOB, { mock: true });
    expect(aiMock.generateObject).not.toHaveBeenCalled();
    expect(criteria).toEqual(fallbackCriteria('bike_repair'));
    expect(sumThousandths(criteria)).toBe(1000);
    expect(criteria[criteria.length - 1].id).toBe('cL');
  });

  it('returns the template when VISION_MOCK=1 (judge path, no key)', async () => {
    vi.stubEnv('VISION_MOCK', '1');
    const criteria = await generateCriteria(JOB);
    expect(aiMock.generateObject).not.toHaveBeenCalled();
    expect(criteria).toEqual(fallbackCriteria('bike_repair'));
  });

  it('normalises a valid 3-item LLM answer and appends cL', async () => {
    aiMock.generateObject.mockResolvedValue({
      object: { criteria: [draftItem(0.5, true), draftItem(0.3), draftItem(0.2)] },
    });
    const fakeModel = { modelId: 'test-model' };
    const criteria = await generateCriteria(JOB, { mock: false, model: fakeModel as never });

    expect(criteria).toHaveLength(4);
    expect(criteria.map((criterion) => criterion.id)).toEqual(['c1', 'c2', 'c3', 'cL']);
    expect(sumThousandths(criteria)).toBe(1000);
  });

  it('accepts a 6-item LLM answer', async () => {
    aiMock.generateObject.mockResolvedValue({
      object: {
        criteria: Array.from({ length: 6 }, (_, index) => draftItem(1 / 6, index === 0)),
      },
    });
    const criteria = await generateCriteria(JOB, { mock: false, model: {} as never });
    expect(criteria.filter((criterion) => criterion.id !== 'cL')).toHaveLength(6);
    expect(sumThousandths(criteria)).toBe(1000);
  });

  it('falls back to the template when the model returns too few criteria', async () => {
    aiMock.generateObject.mockResolvedValue({ object: { criteria: [draftItem(1)] } });
    const criteria = await generateCriteria(JOB, { mock: false, model: {} as never });
    expect(criteria).toEqual(fallbackCriteria('bike_repair'));
  });

  it('falls back to the template when the model throws or times out', async () => {
    aiMock.generateObject.mockRejectedValueOnce(new Error('schema validation failed'));
    expect(await generateCriteria(JOB, { mock: false, model: {} as never })).toEqual(
      fallbackCriteria('bike_repair'),
    );

    aiMock.generateObject.mockRejectedValueOnce(new Error('The operation was aborted due to timeout'));
    expect(await generateCriteria(JOB, { mock: false, model: {} as never })).toEqual(
      fallbackCriteria('bike_repair'),
    );
  });

  it('calls generateObject with the MANUAL §9.1 system prompt, temperature 0.2 and a timeout', async () => {
    aiMock.generateObject.mockResolvedValue({
      object: { criteria: [draftItem(0.5), draftItem(0.3), draftItem(0.2)] },
    });
    await generateCriteria(JOB, { mock: false, model: {} as never });

    expect(aiMock.generateObject).toHaveBeenCalledTimes(1);
    const options = aiMock.generateObject.mock.calls[0][0];
    expect(options.system).toBe(CRITERIA_SYSTEM_PROMPT);
    expect(options.temperature).toBe(0.2);
    expect(options.abortSignal).toBeDefined();
    expect(String(options.prompt)).toContain('Replace bike chain');
    expect(CRITERIA_TIMEOUT_MS).toBe(20_000);
  });

  it('uses the C5 templates exactly (spot checks)', async () => {
    const cleaning = fallbackCriteria('cleaning');
    const oven = cleaning.find((criterion) => criterion.id === 'c4');
    expect(oven?.required).toBe(false);
    expect(sumThousandths(cleaning)).toBe(1000);

    const bike = fallbackCriteria('bike_repair');
    expect(bike.filter((criterion) => criterion.required && criterion.id !== 'cL').map((criterion) => criterion.id)).toEqual([
      'c1',
      'c2',
    ]);

    const delivery = fallbackCriteria('delivery');
    expect(delivery.map((criterion) => criterion.id)).toEqual(['c1', 'c2', 'c3', 'cL']);
    expect(sumThousandths(delivery)).toBe(1000);

    const assembly = fallbackCriteria('assembly');
    expect(assembly.map((criterion) => criterion.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'cL']);

    const other = fallbackCriteria('other');
    expect(other.map((criterion) => criterion.id)).toEqual(['c1', 'c2', 'c3', 'cL']);
  });
});
