import 'server-only';
import { generateObject, type LanguageModel, type ModelMessage } from 'ai';
import {
  VerificationReportSchema,
  type Criterion,
  type VerificationReport,
} from '@/shared/contracts';
import { getVisionModel } from '../ai';
import { buildMockVerificationReport, sha256Of } from './mock';
import { VERIFY_SYSTEM_PROMPT } from './prompts';

/** One uploaded image, already resized/stored by `ingestImage` (or a test fixture). */
export type VerifyImage = {
  /** Stable label used by the model, e.g. "A1", "B1". */
  imageId: string;
  buffer: Buffer | Uint8Array;
  mimeType?: string;
};

export type VerifyEvidenceInput = {
  criteria: Criterion[];
  before: VerifyImage[];
  after: VerifyImage[];
  /** The job's real 4-digit liveness code. */
  livenessCode: string;
  /** Job category, used by the deterministic mock's cleaning override. */
  category?: string | null;
  /**
   * sha256 of the first after image as stored in the evidence row (ORIGINAL bytes).
   * Used to look up recorded fixtures in mock mode; defaults to the sha256 of the buffer.
   */
  firstAfterSha256?: string | null;
  /** Override for tests; defaults to `getVisionModel()`. */
  model?: LanguageModel;
  /** Override the VISION_MOCK flag (default: env VISION_MOCK === "1"). */
  mock?: boolean;
  /** Defaults to VLM_TIMEOUT_MS (45 s). */
  timeoutMs?: number;
  /** Recorded-fixture directory override for tests. */
  fixturesDir?: string;
};

/** Thrown when the VLM still returns an unparseable report after one retry. */
export class VlmInvalidOutput extends Error {
  readonly issues: string;

  constructor(message: string, issues: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VlmInvalidOutput';
    this.issues = issues;
  }
}

export function isVisionMock(): boolean {
  return process.env.VISION_MOCK === '1';
}

function timeoutMs(explicit?: number): number {
  if (explicit && explicit > 0) return explicit;
  const fromEnv = Number(process.env.VLM_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 45_000;
}

/** Clamp a normalized box coordinate into 0..1000. */
function clampCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1000, Math.max(0, value));
}

/** Clamp a confidence into 0..1. */
function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function issuesFromError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeText =
      cause instanceof Error
        ? cause.message
        : typeof cause === 'string'
          ? cause
          : cause === undefined
            ? ''
            : JSON.stringify(cause);
    return [error.message, causeText].filter(Boolean).join(' | ').slice(0, 2000);
  }
  return String(error).slice(0, 2000);
}

/** Build the multimodal user content: instructions + criteria, then labelled images. */
export function buildVerificationContent({
  criteria,
  before,
  after,
  livenessCode,
}: Pick<VerifyEvidenceInput, 'criteria' | 'before' | 'after' | 'livenessCode'>) {
  const content: Array<
    { type: 'text'; text: string } | { type: 'image'; image: Uint8Array; mediaType?: string }
  > = [
    {
      type: 'text',
      text: [
        VERIFY_SYSTEM_PROMPT,
        '',
        'Checklist (criteria JSON):',
        JSON.stringify(criteria, null, 2),
        '',
        `Expected liveness code: ${livenessCode}`,
        'Return your verdicts as JSON matching the schema.',
      ].join('\n'),
    },
  ];

  for (const image of before) {
    content.push({ type: 'text', text: `Image ${image.imageId}:` });
    content.push({
      type: 'image',
      image: image.buffer instanceof Buffer ? new Uint8Array(image.buffer) : image.buffer,
      ...(image.mimeType ? { mediaType: image.mimeType } : {}),
    });
  }
  for (const image of after) {
    content.push({ type: 'text', text: `Image ${image.imageId}:` });
    content.push({
      type: 'image',
      image: image.buffer instanceof Buffer ? new Uint8Array(image.buffer) : image.buffer,
      ...(image.mimeType ? { mediaType: image.mimeType } : {}),
    });
  }

  return content;
}

/**
 * Post-validate the model output so downstream code can trust it:
 * - every criterion has exactly one verdict; missing verdicts become NOT_VISIBLE with confidence 0;
 * - unknown criterion ids are dropped;
 * - confidences, box coordinates and sameScene confidence are clamped into range;
 * - boxes referencing unknown image ids are dropped;
 * - a non-null liveness imageId must exist.
 */
export function normalizeReport(
  report: VerificationReport,
  criteria: Criterion[],
  imageIds: Iterable<string>,
): VerificationReport {
  const knownCriteria = new Map(criteria.map((criterion) => [criterion.id, criterion] as const));
  const knownImages = new Set(imageIds);
  const seen = new Set<string>();
  const verdicts: VerificationReport['verdicts'] = [];

  for (const verdict of report.verdicts) {
    if (!knownCriteria.has(verdict.criterionId) || seen.has(verdict.criterionId)) continue;
    seen.add(verdict.criterionId);
    verdicts.push({
      ...verdict,
      confidence: clampConfidence(verdict.confidence),
      rationale: verdict.rationale.slice(0, 400),
      evidence: verdict.evidence
        .filter((box) => knownImages.has(box.imageId))
        .slice(0, 4)
        .map((box) => ({
          ...box,
          box_2d: [
            clampCoordinate(box.box_2d[0]),
            clampCoordinate(box.box_2d[1]),
            clampCoordinate(box.box_2d[2]),
            clampCoordinate(box.box_2d[3]),
          ] as [number, number, number, number],
          note: box.note.slice(0, 140),
        })),
    });
  }

  for (const criterion of criteria) {
    if (seen.has(criterion.id)) continue;
    verdicts.push({
      criterionId: criterion.id,
      verdict: 'NOT_VISIBLE',
      confidence: 0,
      rationale: 'The vision model did not return a verdict for this criterion.',
      evidence: [],
    });
  }

  const imageQualityIssues = report.imageQualityIssues.filter(
    (issue, index) => report.imageQualityIssues.indexOf(issue) === index,
  );

  return {
    ...report,
    verdicts,
    sameScene: {
      ...report.sameScene,
      confidence: clampConfidence(report.sameScene.confidence),
    },
    livenessCode: {
      ...report.livenessCode,
      imageId:
        report.livenessCode.imageId && knownImages.has(report.livenessCode.imageId)
          ? report.livenessCode.imageId
          : null,
    },
    imageQualityIssues: imageQualityIssues.length > 0 ? imageQualityIssues : ['NONE'],
  };
}

/**
 * Verify before/after evidence against the job's criteria.
 *
 * One VLM call with all images (temperature 0, 45 s timeout). On a schema failure the
 * call is retried once with the validation issues appended; a second failure throws
 * `VlmInvalidOutput` (the orchestrator turns that into HUMAN_REVIEW).
 * With VISION_MOCK=1 no network call happens: the deterministic mock (contract C6) is used.
 */
export async function verifyEvidence(input: VerifyEvidenceInput): Promise<VerificationReport> {
  const images = [...input.before, ...input.after];
  if (input.after.length === 0) {
    throw new Error('verifyEvidence: at least one after image is required');
  }

  const mock = input.mock ?? isVisionMock();
  if (mock) {
    const firstAfterSha256 =
      input.firstAfterSha256 ?? (input.after[0] ? sha256Of(input.after[0].buffer) : null);
    return buildMockVerificationReport({
      criteria: input.criteria,
      category: input.category,
      livenessCode: input.livenessCode,
      firstAfterSha256,
      fixturesDir: input.fixturesDir,
    });
  }

  const model = input.model ?? getVisionModel();
  const content = buildVerificationContent(input);
  const abortSignal = AbortSignal.timeout(timeoutMs(input.timeoutMs));
  const imageIds = images.map((image) => image.imageId);

  const attempt = async (messages: ModelMessage[]) => {
    const { object } = await generateObject({
      model,
      schema: VerificationReportSchema,
      messages,
      temperature: 0,
      abortSignal,
    });
    return object;
  };

  const firstMessages = [{ role: 'user' as const, content }];

  let object: VerificationReport;
  try {
    object = await attempt(firstMessages);
  } catch (firstError) {
    const issues = issuesFromError(firstError);
    const retryMessages = [
      ...firstMessages,
      {
        role: 'user' as const,
        content: [
          {
            type: 'text' as const,
            text: `Your previous output failed validation: ${issues}. Return corrected JSON matching the required schema exactly.`,
          },
        ],
      },
    ];
    try {
      object = await attempt(retryMessages);
    } catch (secondError) {
      throw new VlmInvalidOutput(
        `Vision model did not return a valid verification report after one retry: ${issuesFromError(secondError)}`,
        issuesFromError(secondError),
        { cause: secondError },
      );
    }
  }

  return normalizeReport(object, input.criteria, imageIds);
}
