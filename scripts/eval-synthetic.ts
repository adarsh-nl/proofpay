/**
 * `npx tsx --conditions=react-server scripts/eval-synthetic.ts`
 *
 * Generates a temporary, fully synthetic eval dataset so the eval runner (`npm run eval`)
 * can be exercised offline (no AI key, no real photos) and its report/CLI/fixture
 * mechanics can be verified. It writes into `data/eval-tmp/pairs` by default — `data/` is
 * git-ignored, so nothing synthetic is ever committed to `eval/pairs`.
 *
 * Images follow prompt C10: a 32x32 gray block pattern from a seeded PRNG, upscaled to
 * 800x600, flat blocks (never gradients) and a "SYNTHETIC TEST IMAGE" overlay. File names
 * keep the `before_`/`after_` prefix the runner requires and carry `synthetic` in the
 * name so nobody mistakes them for evidence.
 *
 * The dataset is built for `VISION_MOCK=1` determinism (prompt C6):
 *   01 bike,         all criteria PASS by mock            -> APPROVED
 *   02 cleaning,     mock marks c4 FAIL                   -> PARTIAL (capture 80%)
 *   03 assembly,     all criteria PASS by mock            -> APPROVED
 *   04 other,        expected REJECTED but mock approves  -> deliberate MISMATCH + a
 *                                                             false-capture hit (metric test)
 *   05 delivery,     after photo = an `eval/stock/*` copy -> HUMAN_REVIEW (EXACT_DUPLICATE)
 *   06 cleaning,     after photo = case 01 before copy    -> HUMAN_REVIEW (re-used across jobs)
 *
 * Options: `--out <dir>` (dataset root, default `data/eval-tmp/pairs`), `--help`.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULT_OUT = path.join(process.cwd(), 'data', 'eval-tmp', 'pairs');
const STOCK_DIR = path.join(process.cwd(), 'eval', 'stock');
const WIDTH = 800;
const HEIGHT = 600;
const PATTERN = 32;

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

function pattern(seed: number): Buffer {
  const random = mulberry32(seed);
  const pixels = Buffer.alloc(PATTERN * PATTERN);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = 16 + Math.floor(random() * 16) * 15;
  }
  return pixels;
}

/** C10 synthetic photo: seeded block pattern + explicit "SYNTHETIC TEST IMAGE" overlay. */
async function syntheticPhoto(seed: number, label: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect x="0" y="${HEIGHT - 64}" width="${WIDTH}" height="64" fill="#000000" fill-opacity="0.72"/>
  <text x="20" y="${HEIGHT - 23}" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#ffffff">SYNTHETIC TEST IMAGE · ${label}</text>
</svg>`;
  return sharp(pattern(seed), { raw: { width: PATTERN, height: PATTERN, channels: 1 } })
    .resize(WIDTH, HEIGHT, { kernel: 'nearest' })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

type CriterionSpec = { id: string; label: string; required: boolean; weight: number };

type SyntheticCase = {
  slug: string;
  title: string;
  description: string;
  category: 'cleaning' | 'bike_repair' | 'assembly' | 'delivery' | 'other';
  amount: string;
  livenessCode: string;
  criteria: CriterionSpec[];
  expectedOutcome: 'APPROVED' | 'PARTIAL' | 'REJECTED' | 'HUMAN_REVIEW';
  expectedCriteria: Record<string, 'PASS' | 'FAIL'>;
  notes: string;
  beforeSeed: number;
  afterSeed: number;
  /** Copy these files over the generated after image (stock / cross-case duplicate cases). */
  afterCopy?: string;
  /** Copy this file over the generated before image (case 06 re-uses case 01's before). */
  beforeCopy?: string;
};

const BIKE_CRITERIA: CriterionSpec[] = [
  { id: 'c1', label: 'Chain is new and fully seated on the sprockets', required: true, weight: 0.4 },
  { id: 'c2', label: 'Chain tension is correct', required: true, weight: 0.35 },
  { id: 'c3', label: 'Work area left tidy', required: false, weight: 0.25 },
];

const CLEANING_CRITERIA: CriterionSpec[] = [
  { id: 'c1', label: 'Floor is clear of dust and marks', required: true, weight: 0.2 },
  { id: 'c2', label: 'Surfaces wiped, no streaks', required: true, weight: 0.2 },
  { id: 'c3', label: 'Sink spotless', required: true, weight: 0.2 },
  { id: 'c4', label: 'Oven interior has no visible grease', required: false, weight: 0.2 },
  { id: 'c5', label: 'Rubbish removed', required: true, weight: 0.2 },
];

const ASSEMBLY_CRITERIA: CriterionSpec[] = [
  { id: 'c1', label: 'Item fully assembled, no leftover parts', required: true, weight: 0.5 },
  { id: 'c2', label: 'All panels present and aligned', required: true, weight: 0.3 },
  { id: 'c3', label: 'Packaging removed', required: false, weight: 0.2 },
];

const DELIVERY_CRITERIA: CriterionSpec[] = [
  { id: 'c1', label: 'Parcel visible at the delivery door', required: true, weight: 0.6 },
  { id: 'c2', label: 'Parcel undamaged and dry', required: false, weight: 0.4 },
];

const OTHER_CRITERIA: CriterionSpec[] = [
  { id: 'c1', label: 'The requested work result is clearly visible', required: true, weight: 0.7 },
  { id: 'c2', label: 'Work area is tidy', required: false, weight: 0.3 },
];

const CASES: SyntheticCase[] = [
  {
    slug: '01-synthetic-bike',
    title: 'Synthetic: bike chain replaced (also the source of case 06 reuse)',
    description: 'Synthetic eval case (C10): mock verification passes every criterion, but case 06 copies this case before image as its after image, so the duplicate check flags BOTH jobs (HUMAN_REVIEW).',
    category: 'bike_repair',
    amount: '60.00',
    livenessCode: '1111',
    criteria: BIKE_CRITERIA,
    expectedOutcome: 'HUMAN_REVIEW',
    expectedCriteria: { c1: 'PASS', c2: 'PASS', c3: 'PASS', cL: 'PASS' },
    notes: 'Synthetic mechanics case: the duplicate pair (06 copies 01 before) is symmetric, so both cases go to HUMAN_REVIEW; case 03 is the clean APPROVED capture case.',
    beforeSeed: 101,
    afterSeed: 202,
  },
  {
    slug: '02-synthetic-cleaning-partial',
    title: 'Synthetic: cleaning with greasy oven',
    description: 'Synthetic eval case (C10): the mock verifier fails the non-required oven criterion c4, so the score is 0.80.',
    category: 'cleaning',
    amount: '120.00',
    livenessCode: '2222',
    criteria: CLEANING_CRITERIA,
    expectedOutcome: 'PARTIAL',
    expectedCriteria: { c1: 'PASS', c2: 'PASS', c3: 'PASS', c4: 'FAIL', c5: 'PASS', cL: 'PASS' },
    notes: 'Synthetic mechanics case; expected PARTIAL with 80% capture.',
    beforeSeed: 303,
    afterSeed: 404,
  },
  {
    slug: '03-synthetic-assembly',
    title: 'Synthetic: flat-pack shelf assembled',
    description: 'Synthetic eval case (C10): mock verification passes every criterion.',
    category: 'assembly',
    amount: '80.00',
    livenessCode: '3333',
    criteria: ASSEMBLY_CRITERIA,
    expectedOutcome: 'APPROVED',
    expectedCriteria: { c1: 'PASS', c2: 'PASS', c3: 'PASS', cL: 'PASS' },
    notes: 'Synthetic mechanics case; expected APPROVED in mock mode.',
    beforeSeed: 505,
    afterSeed: 606,
  },
  {
    slug: '04-synthetic-mismatch',
    title: 'Synthetic: deliberate label mismatch',
    description: 'Synthetic eval case (C10): the label says REJECTED but the mock verifier approves, to prove the metric/counting logic reports mismatches and false captures.',
    category: 'other',
    amount: '40.00',
    livenessCode: '4444',
    criteria: OTHER_CRITERIA,
    expectedOutcome: 'REJECTED',
    expectedCriteria: { c1: 'FAIL' },
    notes: 'Deliberate mismatch: expected REJECTED, mock returns APPROVED -> count as 1 false capture.',
    beforeSeed: 707,
    afterSeed: 808,
  },
  {
    slug: '05-synthetic-stock-duplicate',
    title: 'Synthetic: after photo is a known stock image',
    description: 'Synthetic eval case (C10): the after image is a copy of an eval/stock placeholder, so EXACT_DUPLICATE (HIGH) sends the job to HUMAN_REVIEW.',
    category: 'delivery',
    amount: '45.00',
    livenessCode: '5555',
    criteria: DELIVERY_CRITERIA,
    expectedOutcome: 'HUMAN_REVIEW',
    expectedCriteria: {},
    notes: 'Requires eval/stock/placeholder-doorstep-1.jpg to exist (npm run eval:placeholders).',
    beforeSeed: 909,
    afterSeed: 1010,
    afterCopy: 'placeholder-doorstep-1.jpg',
  },
  {
    slug: '06-synthetic-reused-photo',
    title: 'Synthetic: after photo reused from case 01',
    description: 'Synthetic eval case (C10): the after image is a copy of case 01 before image, so it is re-used across jobs -> EXACT_DUPLICATE (HIGH).',
    category: 'cleaning',
    amount: '50.00',
    livenessCode: '6666',
    criteria: CLEANING_CRITERIA,
    expectedOutcome: 'HUMAN_REVIEW',
    expectedCriteria: {},
    notes: 'Requires case 01 to be evaluated in the same run (06 is processed after 01 alphabetically).',
    beforeSeed: 1111,
    afterSeed: 1212,
    beforeCopy: '01-synthetic-bike/before_synthetic_1.jpg',
  },
];

function caseJson(item: SyntheticCase): string {
  return `${JSON.stringify(
    {
      title: item.title,
      description: item.description,
      category: item.category,
      amount: { currency: 'USD', value: item.amount },
      livenessCode: item.livenessCode,
      criteria: item.criteria.map((criterion) => ({
        ...criterion,
        howToVerify: `Synthetic case: verify "${criterion.label}" in the after photo.`,
      })),
      expected: {
        outcome: item.expectedOutcome,
        alternatives: [],
        criteria: item.expectedCriteria,
      },
      notes: `${item.notes} Synthetic images: never use as real evidence.`,
      ready: true,
      exifTakenAt: null,
    },
    null,
    2,
  )}\n`;
}

function parseArgs(argv: string[]): { out: string } {
  let out = DEFAULT_OUT;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      const value = argv[index + 1];
      if (!value) throw new Error('--out needs a directory');
      out = path.resolve(value);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.info('Usage: npx tsx --conditions=react-server scripts/eval-synthetic.ts [--out <dir>]');
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { out };
}

async function main(): Promise<number> {
  const { out } = parseArgs(process.argv.slice(2));
  await rm(out, { recursive: true, force: true });

  for (const item of CASES) {
    const dir = path.join(out, item.slug);
    await mkdir(dir, { recursive: true });
    const beforeFile = path.join(dir, 'before_synthetic_1.jpg');
    const afterFile = path.join(dir, 'after_synthetic_1.jpg');
    await writeFile(beforeFile, await syntheticPhoto(item.beforeSeed, `${item.slug} BEFORE`));
    await writeFile(afterFile, await syntheticPhoto(item.afterSeed, `${item.slug} AFTER`));

    if (item.afterCopy) {
      const source = path.join(STOCK_DIR, item.afterCopy);
      await writeFile(afterFile, await readFile(source));
    }
    if (item.beforeCopy) {
      const source = path.join(out, item.beforeCopy);
      await writeFile(beforeFile, await readFile(source));
    }
    await writeFile(path.join(dir, 'case.json'), caseJson(item));
  }

  console.info(`[eval:synthetic] wrote ${CASES.length} synthetic cases to ${path.relative(process.cwd(), out)}`);
  console.info('[eval:synthetic] run: VISION_MOCK=1 npx tsx --conditions=react-server scripts/eval.ts --pairs-dir ' + path.relative(process.cwd(), out));
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error('[eval:synthetic] failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
