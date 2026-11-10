import 'server-only';
import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import exifr from 'exifr';
import sharp from 'sharp';
import { dhash } from './dhash';

/** Formats accepted for evidence uploads (HEIC is rejected with a clear message). */
export const ALLOWED_IMAGE_FORMATS = ['jpeg', 'png', 'webp'] as const;
export type AllowedImageFormat = (typeof ALLOWED_IMAGE_FORMATS)[number];

/** Longest side of a stored evidence image, in pixels. */
export const MAX_STORED_DIMENSION = 1536;
/** JPEG quality used for stored evidence images. */
export const STORED_JPEG_QUALITY = 85;

export type IngestErrorCode = 'INVALID_IMAGE' | 'UNSUPPORTED_FORMAT';

export class IngestError extends Error {
  readonly code: IngestErrorCode;

  constructor(code: IngestErrorCode, message: string) {
    super(message);
    this.name = 'IngestError';
    this.code = code;
  }
}

export type EvidencePhase = 'before' | 'after';

export type IngestOptions = {
  jobId: string;
  phase: EvidencePhase;
  /** Absolute directory that holds per-job upload folders (UPLOAD_DIR). */
  uploadDir: string;
  /** 1-based sequence number; defaults to the next free `<phase>_<n>.jpg` in the job folder. */
  index?: number;
};

/** What T09 hands to the repository layer; `storedPath` is relative to UPLOAD_DIR. */
export type IngestedImage = {
  sha256: string;
  dhash: string;
  width: number;
  height: number;
  mime: 'image/jpeg';
  storedPath: string;
  /** ISO-8601 UTC timestamp parsed from EXIF, or null when absent/unreadable. */
  exifTakenAt: string | null;
};

const EXIF_FIELDS = ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal', 'OffsetTime'] as const;

type ParsedExif = {
  DateTimeOriginal?: unknown;
  CreateDate?: unknown;
  OffsetTimeOriginal?: unknown;
  OffsetTime?: unknown;
};

/** EXIF datetimes are naive strings like "2026:11:10 12:34:56" (optionally with an offset tag). */
const EXIF_DATETIME_PATTERN = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const EXIF_OFFSET_PATTERN = /^[+-]\d{2}:\d{2}$/;

/**
 * Convert a raw EXIF datetime to ISO-8601.
 *
 * EXIF has no timezone in `DateTimeOriginal`; when `OffsetTimeOriginal` is present we
 * apply it. Without an offset we deliberately treat the timestamp as UTC so that the
 * value is deterministic regardless of the machine timezone (the deployed server also
 * runs in UTC). Assumption noted in the PR; a ±1 h error is inside the 10-minute EXIF
 * window only in extremes and never on its own fails a job.
 */
function toIsoString(value: unknown, offset?: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value !== 'string') return null;

  const match = EXIF_DATETIME_PATTERN.exec(value.trim());
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const [, year, month, day, hour, minute, second] = match;
  const offsetText = typeof offset === 'string' && EXIF_OFFSET_PATTERN.test(offset.trim()) ? offset.trim() : 'Z';
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offsetText}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Read the EXIF timestamp of the original bytes. Never throws: missing EXIF is normal. */
export async function readExifTakenAt(original: Buffer): Promise<string | null> {
  try {
    const parsed = (await exifr.parse(original, {
      pick: [...EXIF_FIELDS],
      reviveValues: false,
    })) as ParsedExif | undefined;
    if (!parsed) return null;
    const offset = parsed.OffsetTimeOriginal ?? parsed.OffsetTime;
    return toIsoString(parsed.DateTimeOriginal, offset) ?? toIsoString(parsed.CreateDate, offset);
  } catch {
    return null;
  }
}

/** Read sharp metadata, mapping decode failures to a clear user-facing error. */
async function readImageMetadata(buffer: Buffer) {
  try {
    return await sharp(buffer).metadata();
  } catch {
    throw new IngestError('INVALID_IMAGE', 'The uploaded file is not a readable image.');
  }
}

async function nextFileIndex(jobDir: string, phase: EvidencePhase): Promise<number> {
  const pattern = new RegExp(`^${phase}_(\\d+)\\.jpg$`);
  let max = 0;
  try {
    const entries = await readdir(jobDir);
    for (const entry of entries) {
      const match = pattern.exec(entry);
      if (match) max = Math.max(max, Number.parseInt(match[1], 10));
    }
  } catch {
    // Folder does not exist yet: start at 1.
  }
  return max + 1;
}

/**
 * Validate, normalise, hash and store one evidence image.
 *
 * - Rejects anything `sharp` cannot decode, and any format outside JPEG/PNG/WebP
 *   (by sniffed metadata, never by the file extension).
 * - Auto-orients (`rotate()`), downscales the longest side to 1536 px without
 *   enlarging, re-encodes as JPEG q85. This also strips all EXIF/GPS metadata
 *   from the *stored* file.
 * - `sha256` is taken over the ORIGINAL uploaded bytes; `dhash` over the stored image.
 * - Stores at `<uploadDir>/<jobId>/<phase>_<n>.jpg` (server-generated name).
 */
export async function ingestImage(buffer: Buffer, options: IngestOptions): Promise<IngestedImage> {
  if (!buffer || buffer.length === 0) {
    throw new IngestError('INVALID_IMAGE', 'The uploaded file is empty.');
  }

  const metadata = await readImageMetadata(buffer);

  const format = metadata.format;
  if (!format || !(ALLOWED_IMAGE_FORMATS as readonly string[]).includes(format)) {
    throw new IngestError(
      'UNSUPPORTED_FORMAT',
      `Unsupported image format "${format ?? 'unknown'}". Upload a JPEG, PNG or WebP image (HEIC is not supported yet).`,
    );
  }

  const sha256 = createHash('sha256').update(buffer).digest('hex');

  const processed = await sharp(buffer)
    .rotate()
    .resize({
      width: MAX_STORED_DIMENSION,
      height: MAX_STORED_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: STORED_JPEG_QUALITY })
    .toBuffer();

  const storedMetadata = await sharp(processed).metadata();
  const storedDhash = await dhash(processed);
  const exifTakenAt = await readExifTakenAt(buffer);

  const jobDir = path.join(options.uploadDir, options.jobId);
  await mkdir(jobDir, { recursive: true });
  const index = options.index ?? (await nextFileIndex(jobDir, options.phase));
  const fileName = `${options.phase}_${index}.jpg`;
  await writeFile(path.join(jobDir, fileName), processed);

  return {
    sha256,
    dhash: storedDhash,
    width: storedMetadata.width ?? 0,
    height: storedMetadata.height ?? 0,
    mime: 'image/jpeg',
    storedPath: `${options.jobId}/${fileName}`,
    exifTakenAt,
  };
}
