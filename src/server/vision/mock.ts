import 'server-only';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  VerificationReportSchema,
  type Criterion,
  type VerificationReport,
} from '@/shared/contracts';

/**
 * Deterministic VISION_MOCK=1 report builder (prompt contract C6).
 *
 * 1. If `eval/fixtures/<sha256 of the first after image>.json` exists, return the
 *    recorded real output (written by `npm run eval -- --record`).
 * 2. Otherwise build a report for the job's ACTUAL criteria: every criterion PASS with
 *    confidence 0.95 and one box per verdict on image `A1`; cL PASS with the job's
 *    liveness code echoed; sameScene SAME 0.9; imageQualityIssues ["NONE"].
 * 3. Category override: for `cleaning`, criterion `c4` is FAIL with confidence 0.88 and
 *    rationale "Grease is still visible on the oven interior." (-> score 0.8 -> PARTIAL).
 *
 * No network, no randomness, no time dependence. `VISION_MOCK=1` paths exist so the
 * whole product runs for judges without an AI key.
 */

export type MockVerificationInput = {
  criteria: Criterion[];
  category?: string | null;
  /** The job's real 4-digit liveness code (the mock echoes it back). */
  livenessCode: string;
  /** sha256 of the first after image; used as the fixture filename. */
  firstAfterSha256?: string | null;
  /** Defaults to `<cwd>/eval/fixtures`. */
  fixturesDir?: string;
};

const DEFAULT_SUMMARY =
  'Mock verification (VISION_MOCK=1): every checklist item was compared with the uploaded before/after photos.';

const CLEANING_OVERRIDE_ID = 'c4';
const CLEANING_OVERRIDE_RATIONALE = 'Grease is still visible on the oven interior.';

function fixtureDirectory(fixturesDir?: string): string {
  return fixturesDir ?? path.join(process.cwd(), 'eval', 'fixtures');
}

async function readRecordedFixture(
  sha256: string | null | undefined,
  fixturesDir?: string,
): Promise<VerificationReport | null> {
  if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  try {
    const raw = await readFile(path.join(fixtureDirectory(fixturesDir), `${sha256}.json`), 'utf8');
    const parsed = VerificationReportSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Deterministic rectangle for the i-th criterion: [ymin, xmin, ymax, xmax] on A1 (0..1000). */
export function mockBoxForIndex(index: number): [number, number, number, number] {
  return [100 + 80 * index, 100, 300 + 80 * index, 500];
}

/** Build the deterministic mock report. Always validates against VerificationReportSchema. */
export async function buildMockVerificationReport({
  criteria,
  category,
  livenessCode,
  firstAfterSha256,
  fixturesDir,
}: MockVerificationInput): Promise<VerificationReport> {
  const recorded = await readRecordedFixture(firstAfterSha256, fixturesDir);
  if (recorded) return recorded;

  const isCleaning = (category ?? '').toLowerCase() === 'cleaning';

  const verdicts = criteria.map((criterion, index) => {
    const override = isCleaning && criterion.id === CLEANING_OVERRIDE_ID;
    return {
      criterionId: criterion.id,
      verdict: override ? ('FAIL' as const) : ('PASS' as const),
      confidence: override ? 0.88 : 0.95,
      rationale: override
        ? CLEANING_OVERRIDE_RATIONALE
        : `Mock check for "${criterion.label}": the requested result is visible in the after photo.`,
      evidence: [
        {
          imageId: 'A1',
          box_2d: mockBoxForIndex(index) as [number, number, number, number],
          note: override ? 'Oven interior still greasy' : 'Mock evidence region',
        },
      ],
    };
  });

  return VerificationReportSchema.parse({
    verdicts,
    sameScene: {
      verdict: 'SAME',
      confidence: 0.9,
      rationale: 'Mock check: before and after photos are treated as the same physical scene.',
    },
    livenessCode: {
      found: true,
      readValue: livenessCode,
      imageId: 'A1',
    },
    imageQualityIssues: ['NONE'],
    summary: DEFAULT_SUMMARY,
  });
}

/** sha256 of an image buffer, used to look up recorded fixtures. */
export function sha256Of(buffer: Buffer | Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}
