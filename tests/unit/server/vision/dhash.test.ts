import { describe, expect, it, vi } from 'vitest';
import { hamming, dhash } from '@/server/vision/dhash';
import { syntheticImage, reencodeJpeg, resizeJpeg } from '../../fixtures/synthetic';


// Image-heavy tests spin up sharp/jpeg encoders; under the full suite's parallel
// workers the default 5 s per-test budget is too tight on CI.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/**
 * dHash properties (prompt contract C10): a q60 re-encode or a resize of the same
 * photo stays at Hamming distance <= 6, while unrelated synthetic images stay >= 20 apart.
 * All images are generated deterministically from seeded PRNGs; no real photos are used.
 */
describe('dhash', () => {
  it('is 16 lowercase hex characters and deterministic', async () => {
    const image = await syntheticImage(1);
    const first = await dhash(image);
    const second = await dhash(image);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(second).toBe(first);
  });

  it('has distance 0 to itself', async () => {
    const hash = await dhash(await syntheticImage(2));
    expect(hamming(hash, hash)).toBe(0);
  });

  it('survives a q60 JPEG re-encode (distance <= 6)', async () => {
    for (const seed of [1, 2, 3, 4]) {
      const original = await dhash(await syntheticImage(seed));
      const reencoded = await dhash(await reencodeJpeg(await syntheticImage(seed), 60));
      expect(hamming(original, reencoded)).toBeLessThanOrEqual(6);
    }
  });

  it('survives a resize (distance <= 6)', async () => {
    const seed = 5;
    const original = await dhash(await syntheticImage(seed));
    for (const [width, height] of [
      [400, 300],
      [1600, 1200],
    ] as const) {
      const resized = await dhash(await resizeJpeg(await syntheticImage(seed), width, height));
      expect(hamming(original, resized)).toBeLessThanOrEqual(6);
    }
  });

  it('keeps different synthetic images >= 20 apart (C10 assertion)', async () => {
    const hashes = new Map<number, string>();
    for (let seed = 1; seed <= 8; seed += 1) {
      hashes.set(seed, await dhash(await syntheticImage(seed)));
    }
    const distances: string[] = [];
    for (let a = 1; a <= 8; a += 1) {
      for (let b = a + 1; b <= 8; b += 1) {
        const distance = hamming(hashes.get(a) as string, hashes.get(b) as string);
        if (distance < 20) distances.push(`seed ${a} vs ${b}: ${distance}`);
      }
    }
    expect(distances).toEqual([]);
  });

  it('rejects empty buffers', async () => {
    await expect(dhash(Buffer.alloc(0))).rejects.toThrow();
  });
});

describe('hamming', () => {
  it('counts bits', () => {
    expect(hamming('0000000000000000', '0000000000000001')).toBe(1);
    expect(hamming('0000000000000000', '000000000000000f')).toBe(4);
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hamming('a500000000810072', 'a500000000810072')).toBe(0);
  });

  it('rejects malformed hashes', () => {
    expect(() => hamming('xyz', '0000000000000000')).toThrow(/hex/i);
  });
});
