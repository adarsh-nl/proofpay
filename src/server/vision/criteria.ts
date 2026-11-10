import 'server-only';
import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { Criterion, JobCategory, Money } from '@/shared/contracts';
import { getLanguageModel } from '../ai';
import { buildTemplateCriteria, LIVENESS_CRITERION_TEMPLATE } from './criteria-templates';
import { CRITERIA_SYSTEM_PROMPT, LVENESS_CODE_PLACEHOLDER } from './prompts';

/**
 * Criteria generator (docs/MANUAL.md §9.1, prompt contract C5).
 *
 * `generateCriteria(job)` asks the configured LLM for 3–6 photo-checkable criteria,
 * normalises the weights to exactly 1.0 (integer thousandths, last item absorbs the
 * rounding), then appends the system liveness criterion `cL` (required, weight 0,
 * label with the `{CODE}` placeholder). On any error, timeout, malformed model
 * output, or with `VISION_MOCK=1` it falls back to the category template from
 * `criteria-templates.ts` — no network call in mock mode.
 */

/** Category fallback templates produce 3–6 criteria plus cL. */
export const MIN_GENERATED_CRITERIA = 3;
export const MAX_GENERATED_CRITERIA = 6;
/** The criteria call must finish within this window or the template is used. */
export const CRITERIA_TIMEOUT_MS = 20_000;
/** Required criteria must keep at least this share of the total weight (10 %). */
export const MIN_REQUIRED_WEIGHT_THOUSANDTHS = 100;
const TOTAL_WEIGHT_THOUSANDTHS = 1000;

export const CriteriaDraftItemSchema = z.object({
  label: z.string().min(3).max(300),
  howToVerify: z.string().min(1).max(1000),
  required: z.boolean(),
  weight: z.number().min(0).max(1),
  phase: z.enum(['after', 'before_after']),
});
export type CriteriaDraftItem = z.infer<typeof CriteriaDraftItemSchema>;

export const CriteriaDraftSchema = z.object({
  criteria: z
    .array(CriteriaDraftItemSchema)
    .min(MIN_GENERATED_CRITERIA)
    .max(MAX_GENERATED_CRITERIA),
});
export type CriteriaDraft = z.infer<typeof CriteriaDraftSchema>;

export type CriteriaJobInput = {
  title: string;
  description: string;
  category: JobCategory;
  amount: Money;
  customerName?: string;
  workerName?: string;
};

export type GenerateCriteriaOptions = {
  /** Force mock/template behaviour (default: `VISION_MOCK === "1"`). */
  mock?: boolean;
  /** Override the 20 s timeout (tests). */
  timeoutMs?: number;
  /** Override the model (tests). */
  model?: LanguageModel;
};

function isVisionMock(): boolean {
  return process.env.VISION_MOCK === '1';
}

/** Split 1000 thousandths evenly, distributing the remainder to the first items. */
function equalThousandths(count: number): number[] {
  const base = Math.floor(TOTAL_WEIGHT_THOUSANDTHS / count);
  const remainder = TOTAL_WEIGHT_THOUSANDTHS - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

/**
 * Normalise raw weights to exactly 1000 integer thousandths.
 *
 * - non-positive/garbage totals fall back to equal weights;
 * - each weight becomes `round(weight / total * 1000)`, then the last weight absorbs
 *   the rounding difference (the float trap: 0.2 + 0.2 + 0.2 + 0.2 is 800.0000000000001
 *   in JS, never 799);
 * - required criteria keep at least 100 thousandths (10 %) by taking weight from the
 *   largest non-required criteria.
 */
export function normaliseWeights(
  rawWeights: number[],
  required: boolean[],
): number[] {
  const count = rawWeights.length;
  if (count === 0) return [];
  if (count === 1) return [TOTAL_WEIGHT_THOUSANDTHS];

  const safeWeights = rawWeights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 0,
  );
  const total = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return equalThousandths(count);

  const scaled = safeWeights.map((weight) => Math.round((weight / total) * TOTAL_WEIGHT_THOUSANDTHS));

  // Required criteria must keep a meaningful share; take it from the largest optional ones.
  let deficit = 0;
  scaled.forEach((thousandths, index) => {
    if (required[index] && thousandths < MIN_REQUIRED_WEIGHT_THOUSANDTHS) {
      deficit += MIN_REQUIRED_WEIGHT_THOUSANDTHS - thousandths;
      scaled[index] = MIN_REQUIRED_WEIGHT_THOUSANDTHS;
    }
  });
  while (deficit > 0) {
    let donorIndex = -1;
    let largest = MIN_REQUIRED_WEIGHT_THOUSANDTHS;
    scaled.forEach((thousandths, index) => {
      if (!required[index] && thousandths > largest) {
        largest = thousandths;
        donorIndex = index;
      }
    });
    if (donorIndex === -1) break;
    const donation = Math.min(deficit, scaled[donorIndex] - MIN_REQUIRED_WEIGHT_THOUSANDTHS);
    scaled[donorIndex] -= donation;
    deficit -= donation;
  }

  // Last item absorbs the rounding difference so the total is exactly 1000.
  const lastIndex = count - 1;
  const beforeLast = scaled.slice(0, lastIndex).reduce((sum, value) => sum + value, 0);
  scaled[lastIndex] = TOTAL_WEIGHT_THOUSANDTHS - beforeLast;

  if (scaled[lastIndex] < 0) {
    return equalThousandths(count);
  }
  return scaled;
}

/**
 * Turn raw model output into storeable `Criterion[]`: ids `c1..cN` in order,
 * normalised weights and the system liveness criterion appended last.
 */
export function normaliseDraftCriteria(items: CriteriaDraftItem[]): Criterion[] {
  if (items.length < MIN_GENERATED_CRITERIA || items.length > MAX_GENERATED_CRITERIA) {
    throw new Error(
      `criteria draft must contain ${MIN_GENERATED_CRITERIA}..${MAX_GENERATED_CRITERIA} items, got ${items.length}`,
    );
  }

  const sorted = items.map((item) => ({
    label: item.label.trim().slice(0, 300),
    howToVerify: item.howToVerify.trim().slice(0, 1000),
    required: item.required,
    weight: item.weight,
    phase: item.phase,
  }));

  const thousandths = normaliseWeights(
    sorted.map((item) => item.weight),
    sorted.map((item) => item.required),
  );

  const criteria: Criterion[] = sorted.map((item, index) => ({
    id: `c${index + 1}`,
    label: item.label,
    howToVerify: item.howToVerify,
    required: item.required,
    weight: thousandths[index] / TOTAL_WEIGHT_THOUSANDTHS,
    phase: item.phase,
    source: 'llm',
  }));

  criteria.push({
    ...LIVENESS_CRITERION_TEMPLATE,
    source: 'system',
    label: LIVENESS_CRITERION_TEMPLATE.label.includes(LVENESS_CODE_PLACEHOLDER)
      ? LIVENESS_CRITERION_TEMPLATE.label
      : `${LIVENESS_CRITERION_TEMPLATE.label}`,
  });

  return criteria;
}

/** The category-template fallback (also used with VISION_MOCK=1). */
export function fallbackCriteria(category: JobCategory): Criterion[] {
  return buildTemplateCriteria(category);
}

/**
 * Generate the acceptance checklist for a job: 3–6 LLM criteria (weights sum to 1)
 * plus the required system liveness criterion. Falls back to the C5 category
 * template on any error, on an out-of-range number of criteria, or when mocked.
 */
export async function generateCriteria(
  job: CriteriaJobInput,
  options: GenerateCriteriaOptions = {},
): Promise<Criterion[]> {
  const mock = options.mock ?? isVisionMock();
  if (mock) return fallbackCriteria(job.category);

  const timeoutMs = options.timeoutMs ?? CRITERIA_TIMEOUT_MS;
  try {
    const model = options.model ?? getLanguageModel();
    const { object } = await generateObject({
      model,
      schema: CriteriaDraftSchema,
      system: CRITERIA_SYSTEM_PROMPT,
      prompt: [
        `Job title: ${job.title}`,
        `Description: ${job.description}`,
        `Category: ${job.category}`,
        `Amount: ${job.amount.value} ${job.amount.currency}`,
        job.customerName ? `Customer: ${job.customerName}` : '',
        job.workerName ? `Worker: ${job.workerName}` : '',
        'Generate the acceptance criteria now.',
      ]
        .filter(Boolean)
        .join('\n'),
      temperature: 0.2,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });

    if (
      !object.criteria ||
      object.criteria.length < MIN_GENERATED_CRITERIA ||
      object.criteria.length > MAX_GENERATED_CRITERIA
    ) {
      return fallbackCriteria(job.category);
    }

    return normaliseDraftCriteria(object.criteria);
  } catch {
    // Timeout, provider error, schema validation failure: the demo must keep working.
    return fallbackCriteria(job.category);
  }
}
