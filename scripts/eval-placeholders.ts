/**
 * `npx tsx scripts/eval-placeholders.ts` — generate the two synthetic STOCK images in
 * `eval/stock/` so the duplicate-detection pipeline (`EXACT_DUPLICATE` /
 * `NEAR_DUPLICATE`) and the e2e fraud path can be developed and tested before the real
 * "parcel on a doorstep" photos exist.
 *
 * Contract (prompt C10):
 * - generated from a seeded PRNG as a 32x32 grayscale BLOCK pattern upscaled to 800x600;
 * - NEVER gradients (their dHash collapses to the same bits);
 * - small overlay text "SYNTHETIC TEST IMAGE";
 * - named `placeholder-*` so nobody mistakes them for real evidence;
 * - asserts that two different seeds have dHash Hamming distance >= 20 and that a q60
 *   re-encode of one seed stays <= 6 (the same bounds T09/T10 test with).
 *
 * The committed jpegs are deterministic: re-running this script must not change them.
 * Real stock photos (the human's own doorstep shots) may replace these later; keep the
 * two files or drop in two real ones with any name.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const WIDTH = 800;
const HEIGHT = 600;
const PATTERN = 32;
const MAX_SIDE = 1600; // sanity check: we stay well below the repo limit
const DISTINCT_DHASH_MIN = 20;
const Q60_DHASH_MAX = 6;

/** Small deterministic PRNG (mulberry32) — no Math.random, no time dependence. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32x32 grayscale "block pattern": 16 quantized levels, flat blocks after upscaling. */
function pattern(seed: number): Buffer {
  const random = mulberry32(seed);
  const pixels = Buffer.alloc(PATTERN * PATTERN);
  for (let index = 0; index < pixels.length; index += 1) {
    // 16 evenly spaced gray levels in [16, 240]; flat fills avoid dHash collapse.
    pixels[index] = 16 + Math.floor(random() * 16) * 15;
  }
  return pixels;
}

function overlayTextSvg(label: string): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect x="0" y="${HEIGHT - 64}" width="${WIDTH}" height="64" fill="#000000" fill-opacity="0.72"/>
  <text x="20" y="${HEIGHT - 23}" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#ffffff">SYNTHETIC TEST IMAGE · ${label}</text>
</svg>`;
  return Buffer.from(svg);
}

/** Build one synthetic stock jpeg (deterministic for a given seed). */
async function buildImage(seed: number, label: string): Promise<Buffer> {
  const patternBuffer = pattern(seed);
  return sharp(patternBuffer, { raw: { width: PATTERN, height: PATTERN, channels: 1 } })
    .resize(WIDTH, HEIGHT, { kernel: 'nearest' })
    .composite([{ input: overlayTextSvg(label), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** dHash: grayscale, 9x8, compare adjacent pixels, 64 bits => 16 hex chars (same as T09). */
async function dhash(input: Buffer): Promise<string> {
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

function hamming(a: string, b: string): number {
  let distance = Math.abs(a.length - b.length) * 4;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    let xor = Number.parseInt(a[index] ?? '0', 16) ^ Number.parseInt(b[index] ?? '0', 16);
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

async function main(): Promise<void> {
  const stockDir = path.join(process.cwd(), 'eval', 'stock');
  await mkdir(stockDir, { recursive: true });

  // Fixed seeds: changing them changes the committed images, so treat them as frozen.
  const seeds = [
    { seed: 1337, file: 'placeholder-doorstep-1.jpg', label: 'stock doorstep 1' },
    { seed: 424242, file: 'placeholder-doorstep-2.jpg', label: 'stock doorstep 2' },
  ];

  const built: { file: string; hash: string; bytes: Buffer; size: number }[] = [];
  for (const { seed, file, label } of seeds) {
    const bytes = await buildImage(seed, label);
    const metadata = await sharp(bytes).metadata();
    if ((metadata.width ?? 0) > MAX_SIDE || (metadata.height ?? 0) > MAX_SIDE) {
      throw new Error(`${file} is bigger than ${MAX_SIDE}px`);
    }
    if (metadata.format !== 'jpeg') throw new Error(`${file} was not encoded as jpeg`);
    built.push({ file, hash: await dhash(bytes), bytes, size: bytes.length });
  }

  // Rule 1: different seeds must produce clearly different dHashes (>= 20 bits of 64).
  // Check every pair among the committed seeds plus two more, so the invariant is real.
  const extraHashes: { seed: number; hash: string }[] = [];
  for (const seed of [7, 99]) {
    extraHashes.push({ seed, hash: await dhash(await buildImage(seed, `seed ${seed}`)) });
  }
  const all = [...built.map((item) => ({ label: item.file, hash: item.hash })), ...extraHashes.map((item) => ({ label: `seed-${item.seed}`, hash: item.hash }))];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const distance = hamming(all[i].hash, all[j].hash);
      if (distance < DISTINCT_DHASH_MIN) {
        throw new Error(
          `dHash of ${all[i].label} and ${all[j].label} is only ${distance} bits apart (< ${DISTINCT_DHASH_MIN}); pick different seeds`,
        );
      }
    }
  }

  // Rule 2: a q60 re-encode of an image must keep its dHash within 6 bits.
  for (const item of built) {
    const reencoded = await sharp(item.bytes).jpeg({ quality: 60 }).toBuffer();
    const distance = hamming(item.hash, await dhash(reencoded));
    if (distance > Q60_DHASH_MAX) {
      throw new Error(`${item.file} drifted ${distance} bits after a q60 re-encode (> ${Q60_DHASH_MAX})`);
    }
    console.info(`[eval:placeholders] ${item.file}: ${item.size} bytes · dHash ${item.hash} · q60 drift ${distance}`);
  }

  for (const item of built) {
    await writeFile(path.join(stockDir, item.file), item.bytes);
  }
  console.info(`[eval:placeholders] wrote ${built.length} synthetic stock images to ${path.relative(process.cwd(), stockDir)}/`);
  console.info('[eval:placeholders] these are NOT real photos; replace them with your own stock doorstep shots for the eval set');
}

main().catch((error: unknown) => {
  console.error('[eval:placeholders] failed:', error);
  process.exitCode = 1;
});
