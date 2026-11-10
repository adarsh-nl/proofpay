/**
 * A04 — partial-settlement path.
 *
 * Seeded `demo-cleaning` ($120.00, cleaning template criteria c1–c5 + liveness): the
 * deterministic mock verifier (C6) marks the non-required oven criterion `c4` FAIL, so the
 * score is 0.80 -> PARTIAL with an 80% capture proposal ($96.00 captured / $24.00 released).
 * The customer's `accept-proposal` click is the money-moving approval (C8); afterwards the
 * job must be CAPTURED for $96.00, strictly less than the $120.00 authorization.
 */
import { expect, test } from '@playwright/test';

import { fetchJob, resetDemoData } from './helpers/api';
import { authorizeJobWithMock, DEMO_CLEANING, openJob, uploadEvidenceAndSubmit } from './helpers/flow';
import { PARTIAL_AFTER_IMAGE, PARTIAL_BEFORE_IMAGE } from './helpers/images';

// Start from the three seeded demo jobs, whatever ran before this file.
test.beforeAll(async ({ request }) => {
  await resetDemoData(request);
});

test.describe('partial settlement path (demo-cleaning)', () => {
  test('PARTIAL proposal 80% -> customer accepts -> CAPTURED $96.00 of $120.00', async ({ page, request }) => {
    // 1. Customer holds $120.00 with the mock PayPal approval.
    await authorizeJobWithMock(page, DEMO_CLEANING);

    // 2. Worker uploads before/after and submits; verification runs in-process.
    await uploadEvidenceAndSubmit(page, DEMO_CLEANING, PARTIAL_BEFORE_IMAGE, PARTIAL_AFTER_IMAGE);

    // 3. The decision is PARTIAL and the settlement agent's proposal is visible with both
    //    amounts (C6: c4 FAIL -> score 0.80 -> capture 80% = $96.00, release $24.00).
    await openJob(page, DEMO_CLEANING, 'customer');
    await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'PARTIAL', { timeout: 45_000 });
    await expect(
      page.getByTestId('timeline-event').filter({ hasText: 'Proposed capture $96.00' }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId('timeline-event').filter({ hasText: 'Would release $24.00' }).first(),
    ).toBeVisible();
    await expect(page.getByTestId('accept-proposal')).toBeVisible();

    // Nothing has been captured yet: the money is still on hold.
    const beforeAccept = await fetchJob(request, DEMO_CLEANING);
    expect(beforeAccept.status).toBe('PARTIAL');
    expect(beforeAccept.payment?.authorized?.value).toBe('120.00');
    expect(beforeAccept.payment?.captured.value).toBe('0.00');
    expect(beforeAccept.latestVerification?.decision.outcome).toBe('PARTIAL');
    expect(beforeAccept.latestVerification?.decision.captureAmount?.value).toBe('96.00');

    // 4. The customer accepts the proposal: the partial capture is executed and the
    //    remainder released (the only click that moves money).
    await page.getByTestId('accept-proposal').click();
    await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'CAPTURED', { timeout: 45_000 });

    const captured = await fetchJob(request, DEMO_CLEANING);
    expect(captured.status).toBe('CAPTURED');
    expect(captured.payment?.captured.value).toBe('96.00');
    expect(Number(captured.payment?.captured.value)).toBeLessThan(Number(captured.payment?.authorized?.value ?? '0'));

    // The customer-facing timeline shows the captured and released amounts.
    await openJob(page, DEMO_CLEANING, 'customer');
    await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'CAPTURED', { timeout: 30_000 });
    await expect(
      page.getByTestId('timeline-event').filter({ hasText: 'Captured $96.00' }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});
