import 'server-only';
import sharp from 'sharp';

/** dHash geometry: 9x8 greyscale pixels -> 8x8 adjacent-pixel comparisons -> 64 bits. */
export const DHASH_COLS = 9;
export const DHASH_ROWS = 8;
export const DHASH_BITS = (DHASH_COLS - 1) * DHASH_ROWS; // 64
export const DHASH_HEX_LENGTH = DHASH_BITS / 4; // 16

const DHASH_PATTERN = /^[0-9a-f]{16}$/;

/**
 * Perceptual dHash (difference hash) of an image.
 *
 * The image is converted to greyscale and resized to 9x8, then for every row the
 * 8 adjacent-pixel comparisons set one bit (left pixel > right pixel -> 1). The
 * 64 bits are rendered as 16 lowercase hex characters. Near-duplicate photos
 * (re-encodes, resizes, small crops) keep a small Hamming distance; unrelated
 * photos are far apart.
 */
export async function dhash(image: Buffer | Uint8Array): Promise<string> {
  if (!image || (image as Buffer).length === 0) {
    throw new Error('dhash: empty image buffer');
  }

  const raw = await sharp(Buffer.from(image as Buffer))
    .greyscale()
    .resize(DHASH_COLS, DHASH_ROWS, { fit: 'fill' })
    .raw()
    .toBuffer();

  if (raw.length !== DHASH_COLS * DHASH_ROWS) {
    throw new Error(`dhash: unexpected raw buffer length ${raw.length}`);
  }

  // Target is ES2017, so no BigInt literals: accumulate the 64 bits as two
  // unsigned 32-bit halves and render each as 8 hex characters.
  let high = 0;
  let low = 0;
  let bitIndex = 0;
  for (let row = 0; row < DHASH_ROWS; row += 1) {
    for (let col = 0; col < DHASH_COLS - 1; col += 1) {
      const left = raw[row * DHASH_COLS + col];
      const right = raw[row * DHASH_COLS + col + 1];
      const bit = left > right ? 1 : 0;
      if (bitIndex < 32) {
        high = ((high << 1) | bit) >>> 0;
      } else {
        low = ((low << 1) | bit) >>> 0;
      }
      bitIndex += 1;
    }
  }

  return high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0');
}

/** Hamming distance between two 16-hex-char dHashes (0 = identical, 64 = opposite). */
export function hamming(a: string, b: string): number {
  if (!DHASH_PATTERN.test(a) || !DHASH_PATTERN.test(b)) {
    throw new Error(`hamming: expected two ${DHASH_HEX_LENGTH}-char hex dHashes, got "${a}" and "${b}"`);
  }

  const popcount32 = (value: number): number => {
    let remaining = value >>> 0;
    let count = 0;
    while (remaining !== 0) {
      remaining = (remaining & (remaining - 1)) >>> 0;
      count += 1;
    }
    return count;
  };

  const highA = Number.parseInt(a.slice(0, 8), 16);
  const lowA = Number.parseInt(a.slice(8), 16);
  const highB = Number.parseInt(b.slice(0, 8), 16);
  const lowB = Number.parseInt(b.slice(8), 16);
  return popcount32(highA ^ highB) + popcount32(lowA ^ lowB);
}
