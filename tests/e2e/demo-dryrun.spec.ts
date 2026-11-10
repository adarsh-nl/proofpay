/**
 * A05 — demo dry-run: run the three demo stories from `docs/DEMO_AND_SUBMISSION.md` §1 in
 * order on the app, capture one named screenshot per script shot into `docs/img/`, measure
 * timings and write `docs/DRYRUN_REPORT.md`.
 *
 * It is EXCLUDED from the default `npm run e2e` (see playwright.config.ts) because it
 * consumes the seeded demo jobs and rewrites the committed README artifacts. Run it on
 * its own against a fresh database/server:
 *
 *   E2E_DRYRUN=1 npx playwright test tests/e2e/demo-dryrun.spec.ts
 *   BASE_URL=https://<render-url> E2E_DRYRUN=1 npx playwright test tests/e2e/demo-dryrun.spec.ts
 *
 * The screenshots are the README "Screenshots" section; the dry-run report records per-shot
 * OK/glitch, per-flow timings and the first-navigation ("cold start") time. Videos are
 * recorded by `playwright.config.ts` into `docs/recordings/e2e/` (git-ignored).
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

import { fetchJob, gotoWithRetry, jobIdFromUrl, resetDemoData, selectRole } from './helpers/api';
import {
  attachEvidenceWithRetry,
  authorizeJobWithMock,
  DEMO_CLEANING,
  DEMO_DELIVERY,
  openJob,
  uploadEvidenceAndSubmit,
} from './helpers/flow';
import {
  AFTER_IMAGE,
  BEFORE_IMAGE,
  FRAUD_BEFORE_IMAGE,
  PARTIAL_AFTER_IMAGE,
  PARTIAL_BEFORE_IMAGE,
  STOCK_DUPLICATE_IMAGE,
} from './helpers/images';

const IMG_DIR = path.join(process.cwd(), 'docs', 'img');
const REPORT_PATH = path.join(process.cwd(), 'docs', 'DRYRUN_REPORT.md');
const MAX_IMAGE_BYTES = 500 * 1024;
const JOB_TITLE = 'Replace bicycle chain';
const JOB_DESCRIPTION =
  'Replace the chain on a city bike, set the correct chain tension and lubricate the drivetrain.';

type Shot = { name: string; label: string; ok: boolean; ms: number; sizeBytes: number; note: string };
type Flow = { name: string; ok: boolean; ms: number };

const shots: Shot[] = [];
const flows: Flow[] = [];
let firstNavigationMs = 0;

/** Reduce the screenshot to a README-friendly PNG that is comfortably below 500 KB. */
async function optimizePng(buffer: Buffer): Promise<Buffer> {
  for (const width of [1280, 1100, 960, 820]) {
    const resized = await sharp(buffer)
      .resize({ width, withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();
    if (resized.length <= MAX_IMAGE_BYTES) return resized;
  }
  return sharp(buffer).resize({ width: 720 }).png({ compressionLevel: 9, palette: true }).toBuffer();
}

async function capture(page: Page, name: string, label: string, note = ''): Promise<void> {
  const started = Date.now();
  try {
    const raw = await page.screenshot({ fullPage: true });
    const optimized = await optimizePng(raw);
    await mkdir(IMG_DIR, { recursive: true });
    const file = path.join(IMG_DIR, `${name}.png`);
    await writeFile(file, optimized);
    shots.push({ name, label, ok: true, ms: Date.now() - started, sizeBytes: optimized.length, note });
  } catch (error) {
    shots.push({
      name,
      label,
      ok: false,
      ms: Date.now() - started,
      sizeBytes: 0,
      note: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function captureViewport(page: Page, name: string, label: string, note = ''): Promise<void> {
  const started = Date.now();
  try {
    const raw = await page.screenshot({ fullPage: false });
    const optimized = await optimizePng(raw);
    await mkdir(IMG_DIR, { recursive: true });
    const file = path.join(IMG_DIR, `${name}.png`);
    await writeFile(file, optimized);
    shots.push({ name, label, ok: true, ms: Date.now() - started, sizeBytes: optimized.length, note });
  } catch (error) {
    shots.push({
      name,
      label,
      ok: false,
      ms: Date.now() - started,
      sizeBytes: 0,
      note: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function recordFlow(name: string, started: number, ok: boolean): void {
  flows.push({ name, ok, ms: Date.now() - started });
}

// Start from the three seeded demo jobs, whatever ran before this file.
test.beforeAll(async ({ request }) => {
  await resetDemoData(request);
});

test.describe.configure({ mode: 'serial' });

test.describe('@dryrun demo dry-run (three stories from the script)', () => {
  test('@dryrun shot 2-5: bike chain full capture ($60.00)', async ({ page, request }) => {
    const started = Date.now();
    let ok = false;
    try {
      // Shot 2 — landing page.
      const navStarted = Date.now();
      await gotoWithRetry(page, '/');
      firstNavigationMs = Date.now() - navStarted;
      await expect(page.getByTestId('role-card-customer')).toBeVisible({ timeout: 30_000 });
      await capture(page, '01-landing', 'Landing: "Money moves when the camera says the job is done."');

      // Shot 3 — customer creates the job, AI checklist appears, then PayPal mock approve.
      await selectRole(page, 'customer');
      await gotoWithRetry(page, '/customer/new');
      await page.getByTestId('create-job-title').fill(JOB_TITLE);
      await page.getByTestId('create-job-description').fill(JOB_DESCRIPTION);
      await page.getByTestId('create-job-category').selectOption('bike_repair');
      await page.getByTestId('create-job-amount').fill('60.00');
      await page.getByTestId('create-job-submit').click();
      await page.waitForURL((url) => /^\/jobs\/[^/?#]+$/.test(url.pathname), { timeout: 45_000 });
      const jobId = jobIdFromUrl(page);
      await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'CREATED', { timeout: 30_000 });
      await capture(page, '02-create-job-ai-checklist', 'Customer creates the job: AI checklist + liveness code');

      await page.getByTestId('paypal-mock-approve').click();
      await expect(page.getByTestId('funds-held')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'AUTHORIZED', { timeout: 30_000 });
      await capture(page, '03-funds-held', 'PayPal authorized: "$60.00 held by PayPal" + authorization id');

      // Shot 4 — worker sees the code, uploads before/after, submits.
      await openJob(page, jobId, 'worker');
      const liveness = page.getByTestId('liveness-code');
      await expect(liveness).toContainText(/\d{4}/, { timeout: 30_000 });
      const submit = page.getByTestId('submit-evidence');
      await attachEvidenceWithRetry(page, BEFORE_IMAGE, AFTER_IMAGE, submit);
      await capture(page, '04-worker-upload-code', 'Worker view: liveness-code banner + before/after evidence');
      await Promise.all([
        page.waitForURL((url) => /^\/jobs\/[^/?#]+$/.test(url.pathname), { timeout: 45_000 }),
        submit.click(),
      ]);

      // Shot 5 — verification result with boxes, then the captured money timeline.
      await openJob(page, jobId, 'customer');
      await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'CAPTURED', { timeout: 60_000 });
      await expect(page.getByTestId('verdict-c1')).toContainText('PASS', { timeout: 20_000 });
      await capture(page, '05-verification-boxes', 'Verification result: per-criterion verdicts with evidence boxes');
      const capturedRow = page.getByTestId('timeline-event').filter({ hasText: 'Captured $60.00' }).first();
      await expect(capturedRow).toBeVisible({ timeout: 20_000 });
      await capturedRow.scrollIntoViewIfNeeded();
      await captureViewport(page, '06-timeline-captured', 'Money timeline: Held $60.00 -> Verified -> Captured $60.00');

      const job = await fetchJob(request, jobId);
      expect(job.status).toBe('CAPTURED');
      expect(job.payment?.captured.value).toBe('60.00');
      ok = true;
    } finally {
      recordFlow('bike chain full capture ($60.00)', started, ok);
    }
  });

  test('@dryrun shot 6: cleaning partial proposal ($96.00 / $24.00)', async ({ page, request }) => {
    const started = Date.now();
    let ok = false;
    try {
      await authorizeJobWithMock(page, DEMO_CLEANING);
      await uploadEvidenceAndSubmit(page, DEMO_CLEANING, PARTIAL_BEFORE_IMAGE, PARTIAL_AFTER_IMAGE);
      await openJob(page, DEMO_CLEANING, 'customer');
      await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'PARTIAL', { timeout: 60_000 });
      await expect(page.getByTestId('accept-proposal')).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByTestId('timeline-event').filter({ hasText: 'Proposed capture $96.00' }).first(),
      ).toBeVisible({ timeout: 20_000 });
      await capture(page, '07-partial-proposal', 'Settlement agent proposal: capture $96.00, release $24.00, customer Accept');

      // Script shot 6 continues: the customer accepts, and the partial capture runs.
      await page.getByTestId('accept-proposal').click();
      await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'CAPTURED', { timeout: 60_000 });
      const job = await fetchJob(request, DEMO_CLEANING);
      expect(job.status).toBe('CAPTURED');
      expect(job.payment?.captured.value).toBe('96.00');
      expect(Number(job.payment?.captured.value)).toBeLessThan(Number(job.payment?.authorized?.value ?? '0'));
      ok = true;
    } finally {
      recordFlow('cleaning partial proposal ($96.00 / $24.00)', started, ok);
    }
  });

  test('@dryrun shot 7: delivery stock photo -> fraud flags -> reviewer evidence pack', async ({ page, request }) => {
    const started = Date.now();
    let ok = false;
    try {
      await authorizeJobWithMock(page, DEMO_DELIVERY);
      await uploadEvidenceAndSubmit(page, DEMO_DELIVERY, FRAUD_BEFORE_IMAGE, STOCK_DUPLICATE_IMAGE);
      await openJob(page, DEMO_DELIVERY, 'customer');
      await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'HUMAN_REVIEW', { timeout: 60_000 });
      await expect(
        page.getByTestId('flag-EXACT_DUPLICATE').or(page.getByTestId('flag-NEAR_DUPLICATE')).first(),
      ).toBeVisible({ timeout: 20_000 });
      await capture(page, '08-fraud-flags', 'Fraud path: duplicate-image flag + HUMAN_REVIEW for the reviewer');

      await selectRole(page, 'reviewer');
      await gotoWithRetry(page, '/reviewer');
      const row = page.getByTestId('reviewer-queue-row').filter({ hasText: DEMO_DELIVERY });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.getByRole('link').first().click();
      await page.waitForURL(/\/reviewer\/jobs\//, { timeout: 30_000 });
      await page.getByTestId('evidence-pack-button').click();
      await expect(page.getByTestId('evidence-pack-markdown')).toContainText(DEMO_DELIVERY, { timeout: 60_000 });
      await capture(page, '09-reviewer-evidence-pack', 'Reviewer evidence pack (markdown) for the duplicate delivery');

      // Script shot 7 continues: the reviewer rejects and the hold is voided.
      await page.getByTestId('review-decision-reject').click();
      await page.getByTestId('review-notes').fill(
        'The after photo is a known stock doorstep image, so the delivery cannot be verified. Rejecting and releasing the hold.',
      );
      await page.getByTestId('review-submit').click();
      await page.waitForURL(/\/reviewer$/, { timeout: 45_000 });
      await openJob(page, DEMO_DELIVERY, 'customer');
      await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'VOIDED', { timeout: 30_000 });
      const job = await fetchJob(request, DEMO_DELIVERY);
      expect(job.status).toBe('VOIDED');
      expect(job.payment?.captured.value).toBe('0.00');
      ok = true;
    } finally {
      recordFlow('delivery fraud flags + reviewer evidence pack', started, ok);
    }
  });

  test.afterAll(async () => {
    const generatedAt = new Date().toISOString();
    const mode = process.env.BASE_URL ? `external \`BASE_URL=${process.env.BASE_URL}\`` : 'local managed server (`next dev`, mocks)';
    const lines: string[] = [];
    lines.push('# Demo dry-run report');
    lines.push('');
    lines.push(`Generated by \`tests/e2e/demo-dryrun.spec.ts\` (@dryrun) at ${generatedAt}.`);
    lines.push(`Mode: ${mode} · Chromium (full channel) · 1280x720 · 1 worker.`);
    lines.push('');
    lines.push('## Flows (`docs/DEMO_AND_SUBMISSION.md` §1 order)');
    lines.push('');
    lines.push('| # | flow | result | duration ms |');
    lines.push('|---|---|---|---|');
    flows.forEach((flow, index) => {
      lines.push(`| ${index + 1} | ${flow.name} | ${flow.ok ? '✅ OK' : '❌ GLITCH'} | ${flow.ms} |`);
    });
    lines.push('');
    lines.push('## Shots (`docs/img/`)');
    lines.push('');
    lines.push('| shot | what | file | result | capture ms | size |');
    lines.push('|---|---|---|---|---|---|');
    for (const shot of shots) {
      lines.push(
        `| ${shot.name} | ${shot.label} | \`docs/img/${shot.name}.png\` | ${shot.ok ? '✅' : '❌'} | ${shot.ms} | ${(shot.sizeBytes / 1024).toFixed(1)} KB |`,
      );
    }
    lines.push('');
    lines.push('## Cold start / first navigation');
    lines.push('');
    lines.push(`- landing page first navigation: **${firstNavigationMs} ms**`);
    if (process.env.BASE_URL) {
      lines.push('- against a hosted Render instance this number includes the free-tier cold start; warm the instance ~2 minutes before recording.');
    } else {
      lines.push('- the number above is measured on the local managed `next dev` server (first request compiles the page), not a Render cold start.');
    }
    lines.push('');
    lines.push('## Glitches / notes');
    lines.push('');
    const glitches = shots.filter((shot) => !shot.ok);
    if (glitches.length === 0) lines.push('- none: every shot was captured and all flows reached their expected end state.');
    else for (const shot of glitches) lines.push(`- ${shot.name}: ${shot.note}`);
    lines.push('');
    lines.push('## How to reproduce');
    lines.push('');
    lines.push('```bash');
    lines.push('# local (mocks, managed server) — excluded from the default `npm run e2e` so the');
    lines.push('# core specs keep a fresh demo database; run it on its own:');
    lines.push('E2E_DRYRUN=1 npx playwright test tests/e2e/demo-dryrun.spec.ts');
    lines.push('');
    lines.push('# against the hosted demo (real sandbox credentials on the Render instance)');
    lines.push('BASE_URL=https://<render-url> E2E_DRYRUN=1 npx playwright test tests/e2e/demo-dryrun.spec.ts');
    lines.push('```');
    lines.push('');
    await writeFile(REPORT_PATH, lines.join('\n'));
    console.info(`[dryrun] wrote ${path.relative(process.cwd(), REPORT_PATH)} (${shots.length} shots, ${flows.length} flows)`);

    // Acceptance: every committed screenshot exists and is < 500 KB.
    for (const shot of shots) {
      const file = path.join(IMG_DIR, `${shot.name}.png`);
      const info = await stat(file);
      expect(info.size, `${shot.name}.png must be < 500 KB`).toBeLessThan(MAX_IMAGE_BYTES);
    }
  });
});
