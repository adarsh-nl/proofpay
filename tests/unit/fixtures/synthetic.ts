import sharp from 'sharp';

// Unit-test images are generated in many parallel vitest workers; keep each sharp
// instance single-threaded so the machine does not thrash under CPU contention.
sharp.concurrency(1);

/**
 * Synthetic test-image generator (prompt contract C10).
 *
 * Real-looking photos are NEVER generated or committed from an agent. Everywhere an
 * agent needs images (unit tests, e2e, `eval/stock` placeholders) it uses this seeded
 * generator: a 32x32 greyscale block pattern upscaled to ~800x600 with a small
 * "SYNTHETIC TEST IMAGE" overlay. No gradients (their dHash collapses to the same bits).
 *
 * The tests assert the two contract properties:
 *   - two different seeds have dHash Hamming distance >= 20, and
 *   - a q60 re-encode of the same seed stays <= 6.
 */

/** Deterministic 32-bit PRNG (mulberry32). Same seed => same image, forever. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export type SyntheticImageOptions = {
  width?: number;
  height?: number;
  /** JPEG quality of the generated image (default 90). */
  quality?: number;
};

const BLOCK_LEVELS = [18, 96, 172, 238];
const BLOCK_SIZE = 4; // 8x8 coarse cells * 4px = 32x32
const COARSE = 8;

/**
 * Deterministic 32x32 greyscale block pattern. 8x8 coarse cells of 4x4 pixels,
 * each a flat level from a fixed palette; nearest-neighbour upscale keeps the blocks
 * crisp so dHash survives re-encoding. The bottom bar holds the overlay text.
 */
function blockPattern(seed: number): Buffer {
  const random = mulberry32(seed);
  const cells = COARSE * BLOCK_SIZE; // 32
  const raw = Buffer.alloc(cells * cells);
  for (let by = 0; by < COARSE; by += 1) {
    for (let bx = 0; bx < COARSE; bx += 1) {
      const level = BLOCK_LEVELS[Math.floor(random() * BLOCK_LEVELS.length)];
      for (let y = 0; y < BLOCK_SIZE; y += 1) {
        for (let x = 0; x < BLOCK_SIZE; x += 1) {
          raw[(by * BLOCK_SIZE + y) * cells + (bx * BLOCK_SIZE + x)] = level;
        }
      }
    }
  }
  return raw;
}

const imageCache = new Map<string, Promise<Buffer>>();

/** Generate a synthetic JPEG (default 800x600, q90, "SYNTHETIC TEST IMAGE <seed>" overlay). */
export async function syntheticImage(
  seed: number,
  options: SyntheticImageOptions = {},
): Promise<Buffer> {
  const width = options.width ?? 800;
  const height = options.height ?? 600;
  const quality = options.quality ?? 90;
  const cacheKey = `${seed}:${width}:${height}:${quality}`;
  const cached = imageCache.get(cacheKey);
  if (cached) return cached;
  const generated = generateSyntheticImage(seed, width, height, quality);
  imageCache.set(cacheKey, generated);
  return generated;
}

async function generateSyntheticImage(
  seed: number,
  width: number,
  height: number,
  quality: number,
): Promise<Buffer> {

  const pattern = blockPattern(seed);
  const base = await sharp(pattern, {
    raw: { width: COARSE * BLOCK_SIZE, height: COARSE * BLOCK_SIZE, channels: 1 },
  })
    .resize(width, height, { kernel: 'nearest' })
    .png()
    .toBuffer();

  const barHeight = Math.max(40, Math.round(height * 0.08));
  const fontSize = Math.max(14, Math.round(barHeight * 0.42));
  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="0" y="${height - barHeight}" width="${width}" height="${barHeight}" fill="#000000"/>` +
      `<text x="16" y="${height - Math.round(barHeight * 0.3)}" font-family="monospace" font-size="${fontSize}" fill="#ffffff">SYNTHETIC TEST IMAGE ${seed}</text>` +
      `</svg>`,
  );

  return sharp(base).composite([{ input: overlay }]).jpeg({ quality }).toBuffer();
}

/** Re-encode a JPEG buffer at a different quality (used by the dHash stability tests). */
export async function reencodeJpeg(buffer: Buffer, quality: number): Promise<Buffer> {
  return sharp(buffer).jpeg({ quality }).toBuffer();
}

/** Resize an image (used to prove dHash is robust to resizing). */
export async function resizeJpeg(buffer: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(buffer).resize(width, height).jpeg({ quality: 90 }).toBuffer();
}

/**
 * Inject a minimal EXIF APP1 segment carrying `DateTimeOriginal` into a JPEG, so the
 * ingest tests can prove EXIF extraction without needing real photos.
 *
 * Structure: SOI, APP1("Exif\0\0" + little-endian TIFF header + IFD0 [ExifIFDPointer]
 * + EXIF IFD [DateTimeOriginal ASCII string]), then the original JPEG body.
 */
export function injectExifTimestamp(jpeg: Buffer, isoDate: string): Buffer {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ISO date: ${isoDate}`);
  const exifDate =
    `${date.getUTCFullYear().toString().padStart(4, '0')}:` +
    `${(date.getUTCMonth() + 1).toString().padStart(2, '0')}:` +
    `${date.getUTCDate().toString().padStart(2, '0')} ` +
    `${date.getUTCHours().toString().padStart(2, '0')}:` +
    `${date.getUTCMinutes().toString().padStart(2, '0')}:` +
    `${date.getUTCSeconds().toString().padStart(2, '0')}`;

  const dateString = Buffer.from(`${exifDate}\0`, 'ascii'); // 20 bytes

  // Little-endian TIFF layout offsets:
  // 0  TIFF header (8 bytes)
  // 8  IFD0: count(2) + 1 entry(12) + next(4) = 18  -> ends at 26
  // 26 EXIF IFD: count(2) + 1 entry(12) + next(4) = 18 -> ends at 44
  // 44 DateTimeOriginal string (20 bytes)
  const tiff = Buffer.alloc(64);
  tiff.write('II', 0, 'ascii'); // little endian
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4); // IFD0 offset

  // IFD0
  tiff.writeUInt16LE(1, 8); // one entry
  tiff.writeUInt16LE(0x8769, 10); // ExifIFDPointer
  tiff.writeUInt16LE(4, 12); // LONG
  tiff.writeUInt32LE(1, 14); // count
  tiff.writeUInt32LE(26, 18); // value: EXIF IFD offset
  tiff.writeUInt32LE(0, 22); // next IFD

  // EXIF IFD
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(0x9003, 28); // DateTimeOriginal
  tiff.writeUInt16LE(2, 30); // ASCII
  tiff.writeUInt32LE(dateString.length, 32);
  tiff.writeUInt32LE(44, 36); // value offset
  tiff.writeUInt32LE(0, 40); // next IFD
  dateString.copy(tiff, 44);

  const exifHeader = Buffer.from('Exif\0\0', 'ascii');
  const app1Payload = Buffer.concat([exifHeader, tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(app1Payload.length + 2, 2);

  // Preserve the original SOI (first 2 bytes) and append our APP1 right after it.
  return Buffer.concat([jpeg.subarray(0, 2), app1, app1Payload, jpeg.subarray(2)]);
}
