/**
 * A04 — fraud path.
 *
 * Seeded `demo-delivery` ($45.00, delivery template criteria): the worker uploads a photo
 * that is already a known stock image (`eval/stock/placeholder-doorstep-1.jpg`) as the
 * AFTER image. Forensics flags EXACT_DUPLICATE (HIGH) -> the decision is HUMAN_REVIEW.
 *
 * The reviewer then opens the job from the queue, generates the evidence pack (markdown
 * containing the job id), rejects the job and the authorization is voided (C8) — the
 * customer never pays.
 */
import { expect, test } from '@playwright/test';

import { fetchJob, gotoWithRetry, selectRole } from './helpers/api';
import { authorizeJobWithMock, DEMO_DELIVERY, openJob, uploadEvidenceAndSubmit } from './helpers/flow';
import { FRAUD_BEFORE_IMAGE, STOCK_DUPLICATE_IMAGE } from './helpers/images';

test.describe('fraud path (demo-delivery, known stock photo)', () => {
  test('stock after photo -> HUMAN_REVIEW with duplicate flag -> reviewer reject -> VOIDED', async ({ page, request }) => {
    // 1. Customer holds $45.00 with the mock PayPal approval.
    await authorizeJobWithMock(page, DEMO_DELIVERY);

    // 2. Worker submits an AFTER photo that is a known stock image (eval/stock).
    await uploadEvidenceAndSubmit(page, DEMO_DELIVERY, FRAUD_BEFORE_IMAGE, STOCK_DUPLICATE_IMAGE);

    // 3. The job is escalated to a human with a duplicate flag (EXACT_DUPLICATE expected;
    //    NEAR_DUPLICATE also indicates reused photos).
    await openJob(page, DEMO_DELIVERY, 'customer');
    await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'HUMAN_REVIEW', { timeout: 45_000 });
    const duplicateFlag = page
      .getByTestId('flag-EXACT_DUPLICATE')
      .or(page.getByTestId('flag-NEAR_DUPLICATE'))
      .first();
    await expect(duplicateFlag).toBeVisible({ timeout: 20_000 });

    const escalated = await fetchJob(request, DEMO_DELIVERY);
    expect(escalated.status).toBe('HUMAN_REVIEW');
    expect(escalated.latestVerification?.decision.outcome).toBe('HUMAN_REVIEW');
    expect(
      escalated.latestVerification?.forensics.flags.some(
        (flag) => flag.code === 'EXACT_DUPLICATE' || flag.code === 'NEAR_DUPLICATE',
      ),
    ).toBe(true);
    expect(escalated.payment?.captured.value).toBe('0.00');

    // 4. The reviewer queue lists the job; open it from the row.
    await selectRole(page, 'reviewer');
    await gotoWithRetry(page, '/reviewer');
    const row = page.getByTestId('reviewer-queue-row').filter({ hasText: DEMO_DELIVERY });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole('link').first().click();
    await page.waitForURL(/\/reviewer\/jobs\//, { timeout: 30_000 });

    // 5. The evidence pack is generated from the review page and contains the job id.
    await page.getByTestId('evidence-pack-button').click();
    await expect(page.getByTestId('evidence-pack-markdown')).toContainText(DEMO_DELIVERY, {
      timeout: 45_000,
    });

    // 6. Reject in the review form: the job is rejected and the hold voided in one submit.
    await page.getByTestId('review-decision-reject').click();
    await page.getByTestId('review-notes').fill(
      'The after photo is a known stock doorstep image, so the delivery cannot be verified. Rejecting and releasing the hold.',
    );
    await page.getByTestId('review-submit').click();
    await page.waitForURL(/\/reviewer$/, { timeout: 30_000 });

    const voided = await fetchJob(request, DEMO_DELIVERY);
    expect(voided.status).toBe('VOIDED');
    expect(voided.payment?.captured.value).toBe('0.00');

    // 7. The customer sees the voided outcome (no money moved).
    await openJob(page, DEMO_DELIVERY, 'customer');
    await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'VOIDED', { timeout: 30_000 });
  });
});
