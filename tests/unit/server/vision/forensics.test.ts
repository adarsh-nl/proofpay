import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { VerificationReport } from '@/shared/contracts';
import {
  clearStockHashCache,
  FORENSICS_THRESHOLDS,
  loadStockHashes,
  runForensics,
  type ForensicsEvidence,
  type StockImage,
} from '@/server/vision/forensics';
import { dhash } from '@/server/vision/dhash';
import { reencodeJpeg, syntheticImage } from '../../fixtures/synthetic';


// Image-heavy tests spin up sharp/jpeg encoders; under the full suite's parallel
// workers the default 5 s per-test budget is too tight on CI.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

vi.mock('server-only', () => ({}));

const sha256 = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');

const AUTHORIZED_AT = '2026-11-10T09:00:00.000Z';
const EXIF_AFTER_JOB = '2026-11-10T12:00:00.000Z';

async function evidenceFor(
  seed: number,
  options: {
    jobId?: string;
    phase?: 'before' | 'after';
    exifTakenAt?: string | null;
    id?: string;
    buffer?: Buffer;
  } = {},
): Promise<ForensicsEvidence> {
  const buffer = options.buffer ?? (await syntheticImage(seed));
  return {
    id: options.id ?? `ev-${options.jobId ?? 'job-a'}-${options.phase ?? 'after'}-${seed}`,
    jobId: options.jobId ?? 'job-a',
    phase: options.phase ?? 'after',
    sha256: sha256(buffer),
    dhash: await dhash(buffer),
    exifTakenAt: options.exifTakenAt === undefined ? EXIF_AFTER_JOB : options.exifTakenAt,
  };
}

function vlmReport(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return {
    verdicts: [],
    sameScene: { verdict: 'SAME', confidence: 0.9, rationale: 'Same place.' },
    livenessCode: { found: true, readValue: '4821', imageId: 'A1' },
    imageQualityIssues: ['NONE'],
    summary: 'test',
    ...overrides,
  };
}

function codes(report: { flags: Array<{ code: string }> }): string[] {
  return report.flags.map((flag) => flag.code);
}

describe('runForensics (MANUAL §9.3)', () => {
  it('reports no flags for clean, distinct before/after photos with EXIF', async () => {
    const evidence = [
      await evidenceFor(1, { phase: 'before', exifTakenAt: AUTHORIZED_AT }),
      await evidenceFor(2, { phase: 'after' }),
    ];
    const report = runForensics({
      job: { id: 'job-a' },
      evidence,
      otherEvidence: [],
      stock: [],
      authorizedAt: AUTHORIZED_AT,
      vlmReport: vlmReport(),
    });
    expect(report.flags).toEqual([]);
  });

  it('flags EXACT_DUPLICATE (HIGH) against evidence from another job', async () => {
    const buffer = await syntheticImage(3);
    const evidence = [await evidenceFor(3, { buffer, phase: 'after' })];
    const otherEvidence = [await evidenceFor(3, { jobId: 'job-b', buffer, phase: 'before' })];
    const report = runForensics({ job: { id: 'job-a' }, evidence, otherEvidence, authorizedAt: AUTHORIZED_AT });
    expect(codes(report)).toContain('EXACT_DUPLICATE');
    expect(report.flags.find((flag) => flag.code === 'EXACT_DUPLICATE')?.level).toBe('HIGH');
  });

  it('flags EXACT_DUPLICATE against a known stock image', async () => {
    const buffer = await syntheticImage(4);
    const evidence = [await evidenceFor(4, { buffer })];
    const stock: StockImage[] = [{ path: '/eval/stock/placeholder-doorstep-1.jpg', sha256: sha256(buffer), dhash: await dhash(buffer) }];
    const report = runForensics({ job: { id: 'job-a' }, evidence, stock, authorizedAt: AUTHORIZED_AT });
    expect(codes(report)).toContain('EXACT_DUPLICATE');
  });

  it('never counts same-job evidence as a duplicate', async () => {
    const buffer = await syntheticImage(5);
    const evidence = [
      await evidenceFor(5, { buffer, phase: 'before' }),
      await evidenceFor(5, { buffer, phase: 'after' }),
    ];
    const report = runForensics({ job: { id: 'job-a' }, evidence, otherEvidence: [], authorizedAt: AUTHORIZED_AT });
    expect(codes(report)).not.toContain('EXACT_DUPLICATE');
    expect(codes(report)).not.toContain('NEAR_DUPLICATE');
  });

  it('flags NEAR_DUPLICATE (HIGH) for a re-encoded photo reused from another job', async () => {
    const original = await syntheticImage(6);
    const reencoded = await reencodeJpeg(original, 70);
    const evidence = [await evidenceFor(6, { buffer: reencoded })];
    const otherEvidence = [await evidenceFor(6, { jobId: 'job-b', buffer: original })];
    const report = runForensics({ job: { id: 'job-a' }, evidence, otherEvidence, authorizedAt: AUTHORIZED_AT });
    expect(codes(report)).toContain('NEAR_DUPLICATE');
    expect(report.flags.find((flag) => flag.code === 'NEAR_DUPLICATE')?.level).toBe('HIGH');
  });

  it('flags NEAR_DUPLICATE against stock images', async () => {
    const original = await syntheticImage(7);
    const reencoded = await reencodeJpeg(original, 75);
    const evidence = [await evidenceFor(7, { buffer: reencoded })];
    const stock: StockImage[] = [{ path: '/eval/stock/placeholder-doorstep-2.jpg', sha256: sha256(original), dhash: await dhash(original) }];
    const report = runForensics({ job: { id: 'job-a' }, evidence, stock, authorizedAt: AUTHORIZED_AT });
    expect(codes(report)).toContain('NEAR_DUPLICATE');
  });

  it('flags NO_CHANGE (MEDIUM) when the before and after photo are the same seed', async () => {
    const evidence = [
      await evidenceFor(8, { phase: 'before', id: 'before-1' }),
      await evidenceFor(8, { phase: 'after', id: 'after-1' }),
    ];
    const report = runForensics({ job: { id: 'job-a' }, evidence, authorizedAt: AUTHORIZED_AT });
    const noChange = report.flags.find((flag) => flag.code === 'NO_CHANGE');
    expect(noChange?.level).toBe('MEDIUM');
    expect(noChange?.evidenceIds).toEqual(['after-1', 'before-1']);
  });

  it('flags EXIF_BEFORE_AUTH (HIGH) when an after-photo predates authorization', async () => {
    const evidence = [
      await evidenceFor(9, { phase: 'before', exifTakenAt: '2026-11-10T08:00:00.000Z' }),
      await evidenceFor(10, { phase: 'after', exifTakenAt: '2026-11-10T08:30:00.000Z' }),
    ];
    // authorized 09:00 -> cutoff 08:50 -> 08:30 is before it.
    const report = runForensics({ job: { id: 'job-a' }, evidence, authorizedAt: AUTHORIZED_AT });
    expect(codes(report)).toContain('EXIF_BEFORE_AUTH');
    expect(report.flags.find((flag) => flag.code === 'EXIF_BEFORE_AUTH')?.level).toBe('HIGH');
  });

  it('does not flag an after-photo taken shortly after authorization', async () => {
    const evidence = [
      await evidenceFor(11, { phase: 'before', exifTakenAt: '2026-11-10T09:01:00.000Z' }),
      await evidenceFor(12, { phase: 'after', exifTakenAt: '2026-11-10T09:05:00.000Z' }),
    ];
    const report = runForensics({ job: { id: 'job-a' }, evidence, authorizedAt: AUTHORIZED_AT });
    expect(codes(report)).not.toContain('EXIF_BEFORE_AUTH');
  });

  it('flags EXIF_MISSING as INFO only (never HIGH)', async () => {
    const evidence = [
      await evidenceFor(13, { phase: 'before', exifTakenAt: null }),
      await evidenceFor(14, { phase: 'after', exifTakenAt: null }),
    ];
    const report = runForensics({ job: { id: 'job-a' }, evidence, authorizedAt: AUTHORIZED_AT });
    expect(codes(report)).toContain('EXIF_MISSING');
    expect(report.flags.find((flag) => flag.code === 'EXIF_MISSING')?.level).toBe('INFO');
    expect(report.flags.some((flag) => flag.level === 'HIGH')).toBe(false);
  });

  it('flags SCENE_MISMATCH (HIGH) when the VLM is confident the places differ', async () => {
    const evidence = [
      await evidenceFor(15, { phase: 'before', exifTakenAt: AUTHORIZED_AT }),
      await evidenceFor(16, { phase: 'after' }),
    ];
    const report = runForensics({
      job: { id: 'job-a' },
      evidence,
      authorizedAt: AUTHORIZED_AT,
      vlmReport: vlmReport({
        sameScene: {
          verdict: 'DIFFERENT',
          confidence: FORENSICS_THRESHOLDS.sceneMismatchConfidence,
          rationale: 'Door and tiles differ.',
        },
      }),
    });
    expect(codes(report)).toContain('SCENE_MISMATCH');
    expect(report.flags.find((flag) => flag.code === 'SCENE_MISMATCH')?.level).toBe('HIGH');
  });

  it('does not flag SCENE_MISMATCH when the VLM is unsure', async () => {
    const evidence = [
      await evidenceFor(17, { phase: 'before', exifTakenAt: AUTHORIZED_AT }),
      await evidenceFor(18, { phase: 'after' }),
    ];
    const report = runForensics({
      job: { id: 'job-a' },
      evidence,
      authorizedAt: AUTHORIZED_AT,
      vlmReport: vlmReport({
        sameScene: { verdict: 'DIFFERENT', confidence: 0.5, rationale: 'Maybe different.' },
      }),
    });
    expect(codes(report)).not.toContain('SCENE_MISMATCH');
  });

  it('flags SCREENSHOT (MEDIUM) when the VLM sees a photo of a screen', async () => {
    const evidence = [
      await evidenceFor(19, { phase: 'before', exifTakenAt: AUTHORIZED_AT }),
      await evidenceFor(20, { phase: 'after' }),
    ];
    const report = runForensics({
      job: { id: 'job-a' },
      evidence,
      authorizedAt: AUTHORIZED_AT,
      vlmReport: vlmReport({ imageQualityIssues: ['BLURRY', 'SCREENSHOT_OF_SCREEN'] }),
    });
    expect(codes(report)).toContain('SCREENSHOT');
    expect(report.flags.find((flag) => flag.code === 'SCREENSHOT')?.level).toBe('MEDIUM');
  });

  it('orders flags HIGH first, then MEDIUM, then INFO', async () => {
    const evidence = [
      await evidenceFor(21, { phase: 'before', exifTakenAt: null }),
      await evidenceFor(21, { phase: 'after', exifTakenAt: '2026-11-10T08:00:00.000Z' }), // NO_CHANGE + EXIF_BEFORE_AUTH + EXIF_MISSING
    ];
    const report = runForensics({ job: { id: 'job-a' }, evidence, authorizedAt: AUTHORIZED_AT });
    const levels = report.flags.map((flag) => flag.level);
    const rank = { HIGH: 0, MEDIUM: 1, INFO: 2 } as const;
    const ranks = levels.map((level) => rank[level]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('loadStockHashes', () => {
  let stockDir: string;

  beforeAll(async () => {
    await mkdir(path.join(process.cwd(), 'data'), { recursive: true });
    stockDir = await mkdtemp(path.join(process.cwd(), 'data', 'stock-test-'));
    await writeFile(path.join(stockDir, 'placeholder-ish-1.jpg'), await syntheticImage(31));
    await writeFile(path.join(stockDir, 'placeholder-ish-2.jpg'), await syntheticImage(32));
    await writeFile(path.join(stockDir, 'notes.txt'), 'not an image');
    await writeFile(path.join(stockDir, '.hidden.jpg'), await syntheticImage(33));
  });

  afterAll(async () => {
    await rm(stockDir, { recursive: true, force: true });
    clearStockHashCache();
  });

  it('hashes every image in the stock directory and skips non-images', async () => {
    clearStockHashCache();
    const stock = await loadStockHashes(stockDir);
    expect(stock).toHaveLength(2);
    for (const item of stock) {
      expect(item.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(item.dhash).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(stock.map((item) => path.basename(item.path))).toEqual([
      'placeholder-ish-1.jpg',
      'placeholder-ish-2.jpg',
    ]);
  });

  it('returns an empty list for a missing directory', async () => {
    clearStockHashCache();
    const stock = await loadStockHashes(path.join(process.cwd(), 'data', 'does-not-exist-stock'));
    expect(stock).toEqual([]);
  });

  it('caches per directory', async () => {
    clearStockHashCache();
    const first = await loadStockHashes(stockDir);
    const second = await loadStockHashes(stockDir);
    expect(second).toBe(first);
  });

  it('detects a stock duplicate end-to-end', async () => {
    clearStockHashCache();
    const stock = await loadStockHashes(stockDir);
    const stockBuffer = await readFile(path.join(stockDir, 'placeholder-ish-1.jpg'));
    const evidence = [await evidenceFor(41, { buffer: stockBuffer })];
    const report = runForensics({ job: { id: 'job-a' }, evidence, stock, authorizedAt: AUTHORIZED_AT });
    expect(codes(report)).toContain('EXACT_DUPLICATE');
  });
});
