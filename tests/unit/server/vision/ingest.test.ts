import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ingestImage, IngestError } from '@/server/vision/ingest';
import { hamming } from '@/server/vision/dhash';
import { injectExifTimestamp, syntheticImage } from '../../fixtures/synthetic';


// Image-heavy tests spin up sharp/jpeg encoders; under the full suite's parallel
// workers the default 5 s per-test budget is too tight on CI.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/**
 * Evidence ingest tests (T09). Images come from the deterministic C10 generator;
 * temporary upload folders live under ./data (gitignored) because the harness
 * sandbox only allows writes inside the repository.
 */
describe('ingestImage', () => {
  let uploadDir: string;

  beforeAll(async () => {
    await mkdir(path.join(process.cwd(), 'data'), { recursive: true });
    uploadDir = await mkdtemp(path.join(process.cwd(), 'data', 'ingest-test-'));
  });

  afterAll(async () => {
    await rm(uploadDir, { recursive: true, force: true });
  });

  it('stores a normalised JPEG and returns sha256, dhash, dimensions and relative path', async () => {
    const buffer = await syntheticImage(11);
    const ingested = await ingestImage(buffer, { jobId: 'job-ingest-1', phase: 'before', uploadDir });

    expect(ingested.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ingested.dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(ingested.width).toBe(800);
    expect(ingested.height).toBe(600);
    expect(ingested.mime).toBe('image/jpeg');
    expect(ingested.storedPath).toBe('job-ingest-1/before_1.jpg');

    const stored = await readFile(path.join(uploadDir, ingested.storedPath));
    const metadata = await sharp(stored).metadata();
    expect(metadata.format).toBe('jpeg');
    // Re-encoding strips EXIF/GPS: the stored file must not carry any.
    expect(metadata.exif).toBeUndefined();
  });

  it('downscales the longest side to 1536 px', async () => {
    const buffer = await syntheticImage(12, { width: 2200, height: 1400 });
    const ingested = await ingestImage(buffer, { jobId: 'job-ingest-2', phase: 'after', uploadDir });
    expect(Math.max(ingested.width, ingested.height)).toBe(1536);
  });

  it('uses the ORIGINAL bytes for sha256 and the stored image for dhash', async () => {
    const buffer = await syntheticImage(13);
    const reencoded = await sharp(buffer).jpeg({ quality: 60 }).toBuffer();
    const first = await ingestImage(buffer, { jobId: 'job-ingest-3', phase: 'before', uploadDir });
    const second = await ingestImage(reencoded, { jobId: 'job-ingest-3', phase: 'after', uploadDir });

    expect(first.sha256).not.toBe(second.sha256);
    expect(hamming(first.dhash, second.dhash)).toBeLessThanOrEqual(6);
  });

  it('numbers files per phase: before_1, before_2, after_1', async () => {
    const buffer = await syntheticImage(14);
    const before1 = await ingestImage(buffer, { jobId: 'job-ingest-4', phase: 'before', uploadDir });
    const before2 = await ingestImage(buffer, { jobId: 'job-ingest-4', phase: 'before', uploadDir });
    const after1 = await ingestImage(buffer, { jobId: 'job-ingest-4', phase: 'after', uploadDir });
    expect(before1.storedPath).toBe('job-ingest-4/before_1.jpg');
    expect(before2.storedPath).toBe('job-ingest-4/before_2.jpg');
    expect(after1.storedPath).toBe('job-ingest-4/after_1.jpg');
  });

  it('extracts the EXIF DateTimeOriginal as ISO-8601', async () => {
    const tagged = injectExifTimestamp(await syntheticImage(15), '2026-11-10T12:34:56.000Z');
    const ingested = await ingestImage(tagged, { jobId: 'job-ingest-5', phase: 'after', uploadDir });
    expect(ingested.exifTakenAt).toBe('2026-11-10T12:34:56.000Z');
  });

  it('returns exifTakenAt null when EXIF is missing', async () => {
    const ingested = await ingestImage(await syntheticImage(16), {
      jobId: 'job-ingest-6',
      phase: 'after',
      uploadDir,
    });
    expect(ingested.exifTakenAt).toBeNull();
  });

  it('rejects a text file renamed to .jpg', async () => {
    const fake = Buffer.from('this is definitely not an image');
    await expect(ingestImage(fake, { jobId: 'job-ingest-7', phase: 'after', uploadDir })).rejects.toMatchObject({
      name: 'IngestError',
      code: 'INVALID_IMAGE',
    });
  });

  it('rejects an unsupported-but-real image format (TIFF) with a clear message', async () => {
    const tiff = await sharp(await syntheticImage(17)).tiff().toBuffer();
    const error = await ingestImage(tiff, { jobId: 'job-ingest-8', phase: 'after', uploadDir }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(IngestError);
    expect((error as IngestError).code).toBe('UNSUPPORTED_FORMAT');
    expect((error as IngestError).message).toMatch(/JPEG, PNG or WebP/i);
  });
});
