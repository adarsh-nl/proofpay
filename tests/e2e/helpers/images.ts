/**
 * Synthetic before/after photos for the e2e suite (prompt C10).
 *
 * Never fake "real" evidence: these are seeded-PRNG 32x32 gray block patterns upscaled
 * to 800x600 with a "SYNTHETIC TEST IMAGE" overlay — no gradients (their dHash collapses),
 * no faces, no PII. The generator asserts that any two different pairs are >= 20 bits
 * apart in dHash terms (so `runForensics` never reports NO_CHANGE / NEAR_DUPLICATE across
 * specs) and that a q60 re-encode keeps a hash within 6 bits of the original.
 *
 * Three committed pairs exist so specs that run in the same server/database do not look
 * like duplicates of each other (forensics flags re-used photos seen in another job):
 *   pair 1 `synthetic-{before,after}-1.jpg` — happy path
 *   pair 2 `synthetic-{before,after}-2.jpg` — partial-settlement path
 *   pair 3 `synthetic-{before,after}-3.jpg` — fraud path before photo (after photo is the
 *            known-stock image `eval/stock/placeholder-doorstep-1.jpg`).
 *
 * Regenerate with: `npx tsx tests/e2e/helpers/generate-fixtures.ts`
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

export const SYNTHETIC_WIDTH = 800;
export const SYNTHETIC_HEIGHT = 600;
export const DISTINCT_DHASH_MIN = 20;
export const Q60_DHASH_MAX = 6;

/** Seeds are frozen: changing them changes the committed fixtures. */
export const SYNTHETIC_PAIRS = [
  { index: 1, label: 'happy', beforeSeed: 20260101, afterSeed: 20260102 },
  { index: 2, label: 'partial', beforeSeed: 20260201, afterSeed: 20260202 },
  { index: 3, label: 'fraud', beforeSeed: 20260301, afterSeed: 20260302 },
] as const;

export type SyntheticPair = {
  beforeFile: string;
  afterFile: string;
  beforeDhash: string;
  afterDhash: string;
  distance: number;
};

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32x32 gray block pattern: 16 flat levels, so it survives a q60 re-encode. */
export function patternBuffer(seed: number): Buffer {
  const random = mulberry32(seed);
  const pixels = Buffer.alloc(32 * 32);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = 16 + Math.floor(random() * 16) * 15;
  }
  return pixels;
}

function overlaySvg(label: string): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SYNTHETIC_WIDTH}" height="${SYNTHETIC_HEIGHT}">
  <rect x="0" y="${SYNTHETIC_HEIGHT - 64}" width="${SYNTHETIC_WIDTH}" height="64" fill="#000000" fill-opacity="0.72"/>
  <text x="20" y="${SYNTHETIC_HEIGHT - 23}" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#ffffff">SYNTHETIC TEST IMAGE · ${label}</text>
</svg>`);
}

export async function buildSyntheticImage(seed: number, label: string): Promise<Buffer> {
  return sharp(patternBuffer(seed), { raw: { width: 32, height: 32, channels: 1 } })
    .resize(SYNTHETIC_WIDTH, SYNTHETIC_HEIGHT, { kernel: 'nearest' })
    .composite([{ input: overlaySvg(label), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** dHash: grayscale, 9x8, adjacent-pixel compare => 16 hex chars (same as T09). */
export async function dhash(input: Buffer): Promise<string> {
  const raw = await sharp(input).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      bits += (raw[y * 9 + x] ?? 0) > (raw[y * 9 + x + 1] ?? 0) ? '1' : '0';
    }
  }
  let hex = '';
  for (let index = 0; index < 64; index += 4) hex += Number.parseInt(bits.slice(index, index + 4), 2).toString(16);
  return hex;
}

export function hamming(a: string, b: string): number {
  let distance = Math.abs(a.length - b.length) * 4;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    let xor = Number.parseInt(a[index] ?? '0', 16) ^ Number.parseInt(b[index] ?? '0', 16);
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/**
 * Generate one pair into `outDir` as `synthetic-before-<n>.jpg` / `synthetic-after-<n>.jpg`
 * and assert the C10 dHash rules against every already-generated pair.
 */
export async function generateSyntheticPairs(outDir: string): Promise<SyntheticPair[]> {
  await mkdir(outDir, { recursive: true });
  const pairs: SyntheticPair[] = [];

  for (const spec of SYNTHETIC_PAIRS) {
    const before = await buildSyntheticImage(spec.beforeSeed, `e2e ${spec.label} before`);
    const after = await buildSyntheticImage(spec.afterSeed, `e2e ${spec.label} after`);
    const beforeDhash = await dhash(before);
    const afterDhash = await dhash(after);
    const distance = hamming(beforeDhash, afterDhash);
    if (distance < DISTINCT_DHASH_MIN) {
      throw new Error(`${spec.label}: before/after dHash only ${distance} bits apart; pick different seeds (C10)`);
    }
    const q60 = hamming(afterDhash, await dhash(await sharp(after).jpeg({ quality: 60 }).toBuffer()));
    if (q60 > Q60_DHASH_MAX) {
      throw new Error(`${spec.label}: after image dHash drifted ${q60} bits at q60 (> ${Q60_DHASH_MAX}, C10)`);
    }
    for (const other of pairs) {
      for (const [a, b, what] of [
        [other.beforeDhash, beforeDhash, 'before/before'],
        [other.afterDhash, afterDhash, 'after/after'],
        [other.beforeDhash, afterDhash, 'before/after'],
        [other.afterDhash, beforeDhash, 'after/before'],
      ] as const) {
        const crossDistance = hamming(a, b);
        if (crossDistance < DISTINCT_DHASH_MIN) {
          throw new Error(`${spec.label}: ${what} dHash only ${crossDistance} bits apart from the previous pair (C10)`);
        }
      }
    }

    const beforeFile = path.join(outDir, `synthetic-before-${spec.index}.jpg`);
    const afterFile = path.join(outDir, `synthetic-after-${spec.index}.jpg`);
    await writeFile(beforeFile, before);
    await writeFile(afterFile, after);
    pairs.push({ beforeFile, afterFile, beforeDhash, afterDhash, distance });
  }
  return pairs;
}

/** Absolute paths of the committed fixtures used by the specs. */
export const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
export const BEFORE_IMAGE = path.join(FIXTURES_DIR, 'synthetic-before-1.jpg');
export const AFTER_IMAGE = path.join(FIXTURES_DIR, 'synthetic-after-1.jpg');
export const PARTIAL_BEFORE_IMAGE = path.join(FIXTURES_DIR, 'synthetic-before-2.jpg');
export const PARTIAL_AFTER_IMAGE = path.join(FIXTURES_DIR, 'synthetic-after-2.jpg');
export const FRAUD_BEFORE_IMAGE = path.join(FIXTURES_DIR, 'synthetic-before-3.jpg');
export const FRAUD_AFTER_IMAGE = path.join(FIXTURES_DIR, 'synthetic-after-3.jpg');

/** A known-stock image (eval/stock) that triggors EXACT_DUPLICATE when uploaded as after. */
export const STOCK_DUPLICATE_IMAGE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'eval',
  'stock',
  'placeholder-doorstep-1.jpg',
);
