/**
 * A03 — happy path: create job -> PayPal authorize -> worker uploads evidence ->
 * AI verifies -> APPROVED -> CAPTURED.
 *
 * Default (offline, deterministic, runs in the managed webServer):
 *   mock PayPal approval (NEXT_PUBLIC_PAYPAL_MOCK=1) + mock vision (VISION_MOCK=1) +
 *   AUTO_CAPTURE_ON_APPROVE=1. Uses only the C3 `data-testid` contract, except the role
 *   switch (C1: `/?as=<role>`).
 *
 * `@live` variant: the real PayPal sandbox popup. It only runs when
 *   - BASE_URL is set (you started the app yourself with NEXT_PUBLIC_PAYPAL_MOCK=0), and
 *   - E2E_BUYER_EMAIL / E2E_BUYER_PASSWORD are set.
 * Command:
 *   BASE_URL=http://localhost:3100 E2E_BUYER_EMAIL=... E2E_BUYER_PASSWORD=... \
 *     npm run e2e -- -g @live
 */
import { expect, test } from '@playwright/test';

import { fetchJob, gotoWithRetry, jobIdFromUrl, selectRole, waitForJobStatus } from './helpers/api';
import { uploadEvidenceAndSubmit } from './helpers/flow';
import { AFTER_IMAGE, BEFORE_IMAGE } from './helpers/images';
import { clickPaypalCheckoutButton, completePaypalSandboxCheckout, liveBuyerCredentials } from './helpers/paypal';

const JOB_TITLE = 'Replace bicycle chain';
const JOB_DESCRIPTION =
  'Replace the chain on a city bike, set the correct chain tension and lubricate the drivetrain. Clean up the work area afterwards.';
const JOB_AMOUNT = '60.00';

/** Create a bike job as the customer and return its html job id. */
async function createBikeJob(page: import('@playwright/test').Page): Promise<string> {
  await selectRole(page, 'customer');
  await gotoWithRetry(page, '/customer/new');

  await page.getByTestId('create-job-title').fill(JOB_TITLE);
  await page.getByTestId('create-job-description').fill(JOB_DESCRIPTION);
  await page.getByTestId('create-job-category').selectOption('bike_repair');
  await page.getByTestId('create-job-amount').fill(JOB_AMOUNT);
  await page.getByTestId('create-job-submit').click();

  await page.waitForURL(/\/jobs\/[^/?#]+/, { timeout: 30_000 });
  const jobId = jobIdFromUrl(page);
  await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'CREATED', { timeout: 20_000 });
  return jobId;
}

test.describe('happy path (mock PayPal + mock vision)', () => {
  test('create job -> authorize -> upload -> APPROVED -> CAPTURED', async ({ page, request }) => {
    // 1. Customer creates the job: status CREATED, AI checklist present.
    const jobId = await createBikeJob(page);
    await expect(page.getByTestId(/^verdict-/)).toHaveCount(0);

    // 2. Mock PayPal approval: the hold is visible on the job page.
    await page.getByTestId('paypal-mock-approve').click();
    await expect(page.getByTestId('funds-held')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'AUTHORIZED', { timeout: 30_000 });
    await expect(page.getByTestId('liveness-code')).toHaveCount(0); // customer never sees the code

    // 3. Worker sees the code and uploads before/after evidence.
    const livenessCode = await uploadEvidenceAndSubmit(page, jobId, BEFORE_IMAGE, AFTER_IMAGE);
    expect(livenessCode).toMatch(/^\d{4}$/);

    // 4. Verification runs in-process; the customer view ends CAPTURED with a verdict
    //    and a $60.00 timeline event (mock C6: all criteria PASS -> APPROVED -> capture).
    await selectRole(page, 'customer');
    await gotoWithRetry(page, `/jobs/${jobId}`);
    await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'CAPTURED', { timeout: 45_000 });
    await expect(page.getByTestId('verdict-c1')).toContainText('PASS');
    await expect(page.getByTestId('timeline-event').filter({ hasText: '$60.00' }).first()).toBeVisible({ timeout: 20_000 });

    const captured = await waitForJobStatus(request, jobId, ['CAPTURED'], 45_000);
    expect(captured.status).toBe('CAPTURED');
    expect(captured.payment?.captured.value).toBe(JOB_AMOUNT);
    expect(captured.latestVerification?.decision.outcome).toBe('APPROVED');
  });
});

const liveCredentials = liveBuyerCredentials();
const liveEnabled = liveCredentials !== null && process.env.BASE_URL !== undefined && process.env.NEXT_PUBLIC_PAYPAL_MOCK !== '1';

test.describe('@live real sandbox PayPal', () => {
  test('@live create job -> PayPal popup login/approve -> upload -> CAPTURED', async ({ page, request }) => {
    test.skip(
      !liveEnabled,
      'needs a manually started app (BASE_URL) with NEXT_PUBLIC_PAYPAL_MOCK=0 and E2E_BUYER_EMAIL/E2E_BUYER_PASSWORD',
    );

    const jobId = await createBikeJob(page);

    // Real PayPal smart buttons (F03), then the sandbox buyer popup (helpers/paypal.ts).
    await expect(page.getByTestId('paypal-buttons')).toBeVisible({ timeout: 30_000 });
    await clickPaypalCheckoutButton(page);
    if (!liveCredentials) throw new Error('live credentials disappeared');
    await completePaypalSandboxCheckout(page, liveCredentials);

    await expect(page.getByTestId('funds-held')).toBeVisible({ timeout: 60_000 });
    await uploadEvidenceAndSubmit(page, jobId, BEFORE_IMAGE, AFTER_IMAGE);

    await selectRole(page, 'customer');
    await gotoWithRetry(page, `/jobs/${jobId}`);
    await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'CAPTURED', { timeout: 90_000 });
    const captured = await fetchJob(request, jobId);
    expect(captured.payment?.captured.value).toBe(JOB_AMOUNT);
  });
});
