import 'server-only';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ForensicsReport, VerificationReport } from '@/shared/contracts';
import { dhash, hamming } from './dhash';

type ForensicsFlag = ForensicsReport['flags'][number];

/** Tunables from docs/MANUAL.md §9.3 (unit-tested; do not change without updating the table). */
export const FORENSICS_THRESHOLDS = {
  /** dHash Hamming distance at or below which two photos are the same photo re-used. */
  nearDuplicateHamming: 6,
  /** Best before/after Hamming distance at or below which "nothing changed". */
  noChangeHamming: 4,
  /** An after-photo taken earlier than authorizedAt - 10 min is impossible. */
  exifBeforeAuthWindowMs: 10 * 60 * 1000,
  /** Minimum VLM confidence before a DIFFERENT scene is a HIGH fraud flag. */
  sceneMismatchConfidence: 0.7,
} as const;

export type ForensicsPhase = 'before' | 'after';

/** The minimum shape of an evidence row that forensics needs (a subset of the DB row). */
export type ForensicsEvidence = {
  id: string;
  jobId: string;
  phase: ForensicsPhase;
  sha256: string;
  dhash: string;
  exifTakenAt?: string | null;
};

/** A known/re-used image from `eval/stock/` (or any other "seen before" corpus). */
export type StockImage = {
  path: string;
  sha256: string;
  dhash: string;
};

export type ForensicsInput = {
  job: { id: string };
  /** Evidence of the job being verified. */
  evidence: ForensicsEvidence[];
  /** Evidence rows belonging to OTHER jobs (same-job evidence never counts as a duplicate). */
  otherEvidence?: ForensicsEvidence[];
  /** Known stock images (`eval/stock/*`), loaded via `loadStockHashes`. */
  stock?: StockImage[];
  /** ISO timestamp of the PayPal authorization; used by the EXIF window check. */
  authorizedAt?: string | null;
  /** The VLM report, when available; enables the scene-mismatch and screenshot flags. */
  vlmReport?: VerificationReport | null;
};

const flag = (
  code: ForensicsFlag['code'],
  level: ForensicsFlag['level'],
  message: string,
  evidenceIds: string[],
): ForensicsFlag => ({ code, level, message, evidenceIds });

/**
 * Deterministic forensics checks from docs/MANUAL.md §9.3. No AI, no I/O:
 * the caller supplies the current job's evidence, evidence from other jobs, the
 * known-stock hashes and (optionally) the VLM report.
 *
 * Flags:
 *  EXACT_DUPLICATE (HIGH)  sha256 matches evidence in another job or a stock image
 *  NEAR_DUPLICATE  (HIGH)  dHash Hamming <= 6 versus another job's evidence or stock
 *  NO_CHANGE       (MEDIUM) best before/after Hamming <= 4 (nothing visibly changed)
 *  EXIF_BEFORE_AUTH (HIGH) after-photo EXIF time earlier than authorization - 10 min
 *  EXIF_MISSING    (INFO)  no EXIF timestamp (never fails verification on its own)
 *  SCENE_MISMATCH  (HIGH)  VLM says BEFORE and AFTER are different places (confidence >= 0.7)
 *  SCREENSHOT      (MEDIUM) VLM saw a photo of a screen
 */
export function runForensics({
  job,
  evidence,
  otherEvidence = [],
  stock = [],
  authorizedAt = null,
  vlmReport = null,
}: ForensicsInput): ForensicsReport {
  if (!job?.id) throw new Error('runForensics: job.id is required');

  const own = evidence.filter((item) => item.jobId === job.id);
  const others = otherEvidence.filter((item) => item.jobId !== job.id);
  const flags: ForensicsFlag[] = [];

  // --- EXACT_DUPLICATE: same bytes seen in another job or in the stock corpus. -----------
  const exactMatches = new Map<string, string[]>();
  for (const item of own) {
    const matchedIds: string[] = [];
    for (const other of others) {
      if (other.sha256 === item.sha256) matchedIds.push(other.id);
    }
    for (const stockImage of stock) {
      if (stockImage.sha256 === item.sha256) matchedIds.push(path.basename(stockImage.path));
    }
    if (matchedIds.length > 0) {
      const existing = exactMatches.get(item.id) ?? [];
      exactMatches.set(item.id, [...existing, ...matchedIds]);
    }
  }
  if (exactMatches.size > 0) {
    const evidenceIds = [...exactMatches.keys()];
    const matchedCount = [...exactMatches.values()].reduce((total, ids) => total + ids.length, 0);
    flags.push(
      flag(
        'EXACT_DUPLICATE',
        'HIGH',
        `${evidenceIds.length} uploaded photo(s) are byte-identical to ${matchedCount} image(s) already seen (${evidenceIds.join(', ')}). The same file cannot prove fresh work.`,
        evidenceIds,
      ),
    );
  }

  // --- NEAR_DUPLICATE: same photo re-encoded/resized/re-used. ---------------------------
  const nearMatches = new Map<string, { distance: number; matchLabel: string }>();
  for (const item of own) {
    for (const other of others) {
      const distance = hamming(item.dhash, other.dhash);
      if (distance <= FORENSICS_THRESHOLDS.nearDuplicateHamming) {
        const current = nearMatches.get(item.id);
        if (!current || distance < current.distance) {
          nearMatches.set(item.id, { distance, matchLabel: `another job's evidence ${other.id}` });
        }
      }
    }
    for (const stockImage of stock) {
      const distance = hamming(item.dhash, stockImage.dhash);
      if (distance <= FORENSICS_THRESHOLDS.nearDuplicateHamming) {
        const current = nearMatches.get(item.id);
        if (!current || distance < current.distance) {
          nearMatches.set(item.id, { distance, matchLabel: `stock image ${path.basename(stockImage.path)}` });
        }
      }
    }
  }
  if (nearMatches.size > 0) {
    const evidenceIds = [...nearMatches.keys()];
    const best = Math.min(...[...nearMatches.values()].map((match) => match.distance));
    const details = evidenceIds
      .map((id) => {
        const match = nearMatches.get(id);
        return `${id} ≈ ${match?.matchLabel} (dHash distance ${match?.distance})`;
      })
      .join('; ');
    flags.push(
      flag(
        'NEAR_DUPLICATE',
        'HIGH',
        `${evidenceIds.length} uploaded photo(s) look like previously seen images (best distance ${best}): ${details}.`,
        evidenceIds,
      ),
    );
  }

  // --- NO_CHANGE: the before and after photo show the same unchanged scene. -------------
  const before = own.filter((item) => item.phase === 'before');
  const after = own.filter((item) => item.phase === 'after');
  let bestPair: { before: ForensicsEvidence; after: ForensicsEvidence; distance: number } | null = null;
  for (const beforeItem of before) {
    for (const afterItem of after) {
      const distance = hamming(beforeItem.dhash, afterItem.dhash);
      if (!bestPair || distance < bestPair.distance) {
        bestPair = { before: beforeItem, after: afterItem, distance };
      }
    }
  }
  if (bestPair && bestPair.distance <= FORENSICS_THRESHOLDS.noChangeHamming) {
    flags.push(
      flag(
        'NO_CHANGE',
        'MEDIUM',
        `The best before/after pair (${bestPair.after.id} vs ${bestPair.before.id}) has dHash distance ${bestPair.distance}: the scene looks unchanged.`,
        [bestPair.after.id, bestPair.before.id],
      ),
    );
  }

  // --- EXIF_BEFORE_AUTH: photo allegedly taken before the job was authorized. -----------
  if (authorizedAt) {
    const authorizedTime = new Date(authorizedAt).getTime();
    if (!Number.isNaN(authorizedTime)) {
      const cutoff = authorizedTime - FORENSICS_THRESHOLDS.exifBeforeAuthWindowMs;
      const offending = own.filter((item) => {
        if (item.phase !== 'after' || !item.exifTakenAt) return false;
        const takenTime = new Date(item.exifTakenAt).getTime();
        return !Number.isNaN(takenTime) && takenTime < cutoff;
      });
      if (offending.length > 0) {
        flags.push(
          flag(
            'EXIF_BEFORE_AUTH',
            'HIGH',
            `${offending.length} after-photo(s) carry an EXIF timestamp earlier than 10 minutes before the payment was authorized (${offending.map((item) => item.id).join(', ')}). A photo taken before the job started cannot show the finished work.`,
            offending.map((item) => item.id),
          ),
        );
      }
    }
  }

  // --- EXIF_MISSING: informational; many apps strip EXIF. -------------------------------
  const missingExif = own.filter((item) => !item.exifTakenAt);
  if (missingExif.length > 0) {
    flags.push(
      flag(
        'EXIF_MISSING',
        'INFO',
        `${missingExif.length} of ${own.length} photo(s) have no EXIF timestamp (${missingExif.map((item) => item.id).join(', ')}). The capture time cannot be checked for these; this alone is not treated as fraud.`,
        missingExif.map((item) => item.id),
      ),
    );
  }

  // --- SCENE_MISMATCH: the VLM says before and after are different places. --------------
  if (
    vlmReport?.sameScene &&
    vlmReport.sameScene.verdict === 'DIFFERENT' &&
    vlmReport.sameScene.confidence >= FORENSICS_THRESHOLDS.sceneMismatchConfidence
  ) {
    flags.push(
      flag(
        'SCENE_MISMATCH',
        'HIGH',
        `The vision model says the before and after photos show a different scene (confidence ${vlmReport.sameScene.confidence.toFixed(2)}): ${vlmReport.sameScene.rationale}`,
        [],
      ),
    );
  }

  // --- SCREENSHOT: photo of a screen, not of the real world. ----------------------------
  if (vlmReport?.imageQualityIssues?.includes('SCREENSHOT_OF_SCREEN')) {
    flags.push(
      flag(
        'SCREENSHOT',
        'MEDIUM',
        'At least one photo looks like a screenshot or a photo of a screen rather than a photo of the real scene.',
        [],
      ),
    );
  }

  const levelOrder: Record<ForensicsFlag['level'], number> = { HIGH: 0, MEDIUM: 1, INFO: 2 };
  flags.sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);

  return { flags };
}

/** Extensions treated as images inside `eval/stock/`. */
const STOCK_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const stockCache = new Map<string, Promise<StockImage[]>>();

/**
 * Compute sha256 + dHash for every image in `eval/stock/` (default `<cwd>/eval/stock`),
 * once per process. A missing directory yields an empty list (e.g. before A01 has run).
 */
export async function loadStockHashes(dir?: string): Promise<StockImage[]> {
  const resolvedDir = path.resolve(dir ?? path.join(process.cwd(), 'eval', 'stock'));
  const cached = stockCache.get(resolvedDir);
  if (cached) return cached;

  const loading = (async (): Promise<StockImage[]> => {
    let entries: string[];
    try {
      entries = await readdir(resolvedDir);
    } catch {
      return [];
    }

    const stocks: StockImage[] = [];
    for (const entry of entries.sort()) {
      if (entry.startsWith('.')) continue;
      if (!STOCK_EXTENSIONS.has(path.extname(entry).toLowerCase())) continue;
      const absolutePath = path.join(resolvedDir, entry);
      try {
        const buffer = await readFile(absolutePath);
        stocks.push({
          path: absolutePath,
          sha256: createHash('sha256').update(buffer).digest('hex'),
          dhash: await dhash(buffer),
        });
      } catch {
        // Ignore unreadable/corrupt files: stock hashes are best-effort.
      }
    }
    return stocks;
  })();

  stockCache.set(resolvedDir, loading);
  return loading;
}

/** Test-only helper to clear the module-level stock cache. */
export function clearStockHashCache(): void {
  stockCache.clear();
}
