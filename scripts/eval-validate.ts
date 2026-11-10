/**
 * `npm run eval:validate` — validate and normalise the ProofPay eval set.
 *
 * Does, for every folder in `eval/pairs/`:
 * 1. `case.json` exists and parses against the shared zod schema (`scripts/eval-schema.ts`).
 * 2. A case marked `ready:true` has at least one `before_*` and one `after_*` image.
 * 3. Every image is a real jpeg/png/webp and <= `MAX_SIDE` px (larger ones are resized
 *    in place).
 * 4. The `DateTimeOriginal` of the after photo is recorded into `case.json.exifTakenAt`
 *    BEFORE the image is re-encoded; re-encoding with sharp drops all EXIF metadata
 *    (including GPS), so committed photos carry no location data.
 * The images in `eval/stock/` are checked the same way and must contain >= 2 files (the
 * duplicate-detection pipeline treats them as "known stock photos").
 *
 * Exit code 0 = the dataset is valid (unready cases are skipped and counted), 1 = at
 * least one problem that must be fixed before committing photos.
 */
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp, { type Metadata } from 'sharp';
import * as exifr from 'exifr';

import {
  CASE_DIR_PATTERN,
  CASE_IMAGE_PATTERN,
  EvalCaseSchema,
  type EvalCase,
} from './eval-schema';

const MAX_SIDE = 1600;
const MIN_STOCK_IMAGES = 2;
const EXIF_PICK = [
  'DateTimeOriginal',
  'CreateDate',
  'Make',
  'Model',
  'latitude',
  'longitude',
  'GPSLatitude',
  'GPSLongitude',
] as const;

type Issue = { caseId: string; message: string };
type ImageOutcome = { width: number; height: number; resized: boolean; stripped: boolean };

const ROOT = process.cwd();
const PAIRS_DIR = path.join(ROOT, 'eval', 'pairs');
const STOCK_DIR = path.join(ROOT, 'eval', 'stock');

function formatIssue(issue: Issue): string {
  return `  ✗ ${issue.caseId}: ${issue.message}`;
}

/** Write bytes through a temp file + rename so a failed encode cannot truncate a photo. */
async function writeFileAtomic(filePath: string, bytes: Buffer): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.tmp-${path.basename(filePath)}`);
  await mkdir(dir, { recursive: true });
  await writeFile(tmp, bytes);
  await rename(tmp, filePath);
}

function isImageMetadata(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Parse EXIF into a plain object; any failure means "no usable EXIF".
 * Params are the file bytes, not the path: exifr's path reader leaks a FileHandle that
 * recent Node versions refuse to close silently during garbage collection.
 */
async function readExif(filePath: string): Promise<Record<string, unknown>> {
  try {
    const bytes = await readFile(filePath);
    const parsed: unknown = await exifr.parse(bytes, { pick: [...EXIF_PICK] });
    return isImageMetadata(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

/**
 * Check one image, and re-encode it when it needs resizing or EXIF stripping.
 * Returns null on a hard problem (already recorded as an issue by the caller).
 */
async function processImage(
  filePath: string,
  issues: Issue[],
  caseId: string,
): Promise<ImageOutcome | null> {
  let metadata: Metadata;
  try {
    metadata = await sharp(filePath).metadata();
  } catch {
    issues.push({ caseId, message: `${path.basename(filePath)} is not a readable image` });
    return null;
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const format = metadata.format;
  if (width < 2 || height < 2) {
    issues.push({ caseId, message: `${path.basename(filePath)} has no usable dimensions` });
    return null;
  }
  if (format !== 'jpeg' && format !== 'png' && format !== 'webp') {
    issues.push({
      caseId,
      message: `${path.basename(filePath)} is ${format ?? 'unknown'}; use jpeg, png or webp`,
    });
    return null;
  }

  const exif = await readExif(filePath);
  const hasExif = Object.keys(exif).length > 0;
  const needsResize = width > MAX_SIDE || height > MAX_SIDE;
  if (!needsResize && !hasExif) {
    return { width, height, resized: false, stripped: false };
  }

  // sharp drops all metadata by default, so this strips EXIF (incl. GPS) as well as
  // resizing. `.rotate()` applies the EXIF orientation before the metadata disappears.
  let pipeline = sharp(filePath).rotate();
  if (needsResize) {
    pipeline = pipeline.resize({
      width: MAX_SIDE,
      height: MAX_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true });
  else if (format === 'png') pipeline = pipeline.png({ compressionLevel: 9 });
  else pipeline = pipeline.webp({ quality: 90 });

  const bytes = await pipeline.toBuffer();
  await writeFileAtomic(filePath, bytes);
  return { width, height, resized: needsResize, stripped: hasExif };
}

/** Validate the optional `criteria` block (the pipeline appends `cL` itself). */
function checkCriteria(caseId: string, evalCase: EvalCase, issues: Issue[]): void {
  const criteria = evalCase.criteria;
  if (!criteria) return;
  const ids = criteria.map((criterion) => criterion.id);
  const expectedIds = criteria.map((_, index) => `c${index + 1}`);
  if (ids.join(',') !== expectedIds.join(',')) {
    issues.push({ caseId, message: `criteria ids must be c1..c${criteria.length} in order, got ${ids.join(',')}` });
  }
  if (ids.includes('cL')) {
    issues.push({ caseId, message: 'do not list the system liveness criterion cL in case.json; the pipeline appends it' });
  }
  const total = criteria.reduce((sum, criterion) => sum + Math.round(criterion.weight * 1000), 0);
  if (Math.abs(total - 1000) > 1) {
    issues.push({ caseId, message: `criteria weights must sum to 1 (got ${(total / 1000).toFixed(3)})` });
  }
}

type CaseResult = {
  ready: boolean;
  photos: number;
  resized: number;
  stripped: number;
  exifRecorded: number;
  warnings: string[];
};

async function validateCase(
  dirName: string,
  seenCodes: Map<string, string>,
  issues: Issue[],
): Promise<CaseResult | null> {
  const caseId = dirName;
  const caseDir = path.join(PAIRS_DIR, dirName);
  const result: CaseResult = {
    ready: false,
    photos: 0,
    resized: 0,
    stripped: 0,
    exifRecorded: 0,
    warnings: [],
  };

  if (!CASE_DIR_PATTERN.test(dirName)) {
    issues.push({ caseId, message: 'folder name must look like 01-desk-clean (two digits, lowercase slug)' });
    return null;
  }

  const casePath = path.join(caseDir, 'case.json');
  let text: string;
  try {
    text = await readFile(casePath, 'utf8');
  } catch {
    issues.push({ caseId, message: 'missing case.json' });
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    issues.push({ caseId, message: `case.json is not valid JSON (${(error as Error).message})` });
    return null;
  }

  const parsed = EvalCaseSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
      .join('; ');
    issues.push({ caseId, message: `case.json schema error: ${details}` });
    return null;
  }
  const evalCase = parsed.data;
  result.ready = evalCase.ready;
  checkCriteria(caseId, evalCase, issues);

  const previousCode = seenCodes.get(evalCase.livenessCode);
  if (previousCode) {
    issues.push({
      caseId,
      message: `livenessCode ${evalCase.livenessCode} is also used by ${previousCode}; each case needs a unique code`,
    });
  } else {
    seenCodes.set(evalCase.livenessCode, caseId);
  }

  const entries = await readdir(caseDir, { withFileTypes: true });
  const images = entries.filter((entry) => entry.isFile() && CASE_IMAGE_PATTERN.test(entry.name)).map((entry) => entry.name);
  const beforeImages = images.filter((name) => /^before_/i.test(name));
  const afterImages = images.filter((name) => /^after_/i.test(name));
  result.photos = images.length;

  if (evalCase.ready && (beforeImages.length === 0 || afterImages.length === 0)) {
    issues.push({
      caseId,
      message: `marked ready:true but has ${beforeImages.length} before_* and ${afterImages.length} after_* image(s); add the photos or set ready:false`,
    });
  }

  let dirty = false;
  for (const name of images.sort()) {
    const filePath = path.join(caseDir, name);

    // Read the after photo's timestamp BEFORE processImage re-encodes it (sharp drops
    // all metadata by default, so the EXIF is gone after that step).
    if (/^after_/i.test(name) && evalCase.exifTakenAt === null) {
      const exif = await readExif(filePath);
      const takenAt = toIsoDate(exif.DateTimeOriginal) ?? toIsoDate(exif.CreateDate);
      if (takenAt) {
        // Mutate the RAW object so unknown/human-added fields survive the rewrite.
        (raw as Record<string, unknown>).exifTakenAt = takenAt;
        evalCase.exifTakenAt = takenAt;
        dirty = true;
        result.exifRecorded += 1;
      } else if (evalCase.ready) {
        result.warnings.push(
          `${name} has no DateTimeOriginal; forensics will raise EXIF_MISSING (INFO). Re-shoot with camera EXIF or set exifTakenAt manually.`,
        );
      }
    }

    const outcome = await processImage(filePath, issues, caseId);
    if (!outcome) continue;
    if (outcome.resized) result.resized += 1;
    if (outcome.stripped) result.stripped += 1;
  }

  if (dirty) {
    await writeFile(casePath, `${JSON.stringify(raw, null, 2)}\n`);
  }
  if (!evalCase.ready && images.length > 0) {
    result.warnings.push(`has ${images.length} photo(s) but ready:false; flip it to true once the pair is complete`);
  }
  return result;
}

async function validateStock(issues: Issue[]): Promise<{ images: number; resized: number; stripped: number }> {
  const summary = { images: 0, resized: 0, stripped: 0 };
  let entries;
  try {
    entries = await readdir(STOCK_DIR, { withFileTypes: true });
  } catch {
    issues.push({
      caseId: 'eval/stock',
      message: `missing directory; need >= ${MIN_STOCK_IMAGES} stock images (run npx tsx scripts/eval-placeholders.ts)`,
    });
    return summary;
  }
  const images = entries.filter((entry) => entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name));
  summary.images = images.length;
  if (images.length < MIN_STOCK_IMAGES) {
    issues.push({
      caseId: 'eval/stock',
      message: `has ${images.length} image(s); need >= ${MIN_STOCK_IMAGES} for the duplicate checks (run npx tsx scripts/eval-placeholders.ts)`,
    });
  }
  for (const entry of images) {
    const outcome = await processImage(path.join(STOCK_DIR, entry.name), issues, 'eval/stock');
    if (!outcome) continue;
    if (outcome.resized) summary.resized += 1;
    if (outcome.stripped) summary.stripped += 1;
    if (/^synthetic-/i.test(entry.name) || /^placeholder-/i.test(entry.name)) continue;
    // Real stock photos are allowed; only synthetic ones must be named synthetic-*/placeholder-*.
  }
  return summary;
}

async function main(): Promise<number> {
  const issues: Issue[] = [];
  const warnings: string[] = [];

  let caseDirs: string[];
  try {
    const entries = await readdir(PAIRS_DIR, { withFileTypes: true });
    caseDirs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    console.error(`[eval:validate] missing directory ${path.relative(ROOT, PAIRS_DIR)}`);
    return 1;
  }

  if (caseDirs.length === 0) {
    console.error('[eval:validate] no eval cases found under eval/pairs/');
    return 1;
  }

  const seenCodes = new Map<string, string>();
  let ready = 0;
  let pending = 0;
  let photos = 0;
  let resized = 0;
  let stripped = 0;
  let exifRecorded = 0;
  let pairsWithImages = 0;

  for (const dirName of caseDirs) {
    const result = await validateCase(dirName, seenCodes, issues);
    if (!result) continue;
    if (result.ready) ready += 1;
    else pending += 1;
    photos += result.photos;
    resized += result.resized;
    stripped += result.stripped;
    exifRecorded += result.exifRecorded;
    if (result.photos > 0) pairsWithImages += 1;
    warnings.push(...result.warnings.map((warning) => `${dirName}: ${warning}`));
  }

  const stock = await validateStock(issues);
  resized += stock.resized;
  stripped += stock.stripped;

  console.info('[eval:validate] ProofPay eval dataset');
  console.info(
    `  cases: ${caseDirs.length} found · ${ready} ready · ${pending} waiting for photos (${pairsWithImages} with photos)`,
  );
  console.info(`  images: ${photos} in eval/pairs · ${stock.images} stock · ${resized} resized to <= ${MAX_SIDE}px · ${stripped} EXIF stripped`);
  if (exifRecorded > 0) {
    console.info(`  exifTakenAt: recorded for ${exifRecorded} case(s) before stripping`);
  }
  if (warnings.length > 0) {
    console.info(`  notes (not errors):`);
    for (const warning of warnings) console.info(`    · ${warning}`);
  }
  if (issues.length > 0) {
    console.error(`  FAILED with ${issues.length} issue(s):`);
    for (const issue of issues) console.error(formatIssue(issue));
    return 1;
  }
  console.info(`  OK: eval set valid${pending > 0 ? ` (${pending} case(s) still need real photos — see docs/EVAL_SHOOT_GUIDE.md)` : ''}`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error('[eval:validate] unexpected error:', error);
    process.exitCode = 1;
  });
