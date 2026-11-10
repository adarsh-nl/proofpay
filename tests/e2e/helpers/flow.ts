/**
 * Shared UI flows for the e2e specs (all locators are the C3 `data-testid` contract).
 */
import { expect, type Page } from '@playwright/test';

import { gotoWithRetry, selectRole } from './api';

/** Seeded demo jobs (C4) use stable ids. */
export const DEMO_BIKE = 'demo-bike';
export const DEMO_CLEANING = 'demo-cleaning';
export const DEMO_DELIVERY = 'demo-delivery';

export type DemoRole = 'customer' | 'worker' | 'reviewer';

/** Switch to `role` and open the job page for that role. */
export async function openJob(page: Page, jobId: string, role: DemoRole = 'customer'): Promise<void> {
  await selectRole(page, role);
  const path = role === 'worker' ? `/worker/jobs/${jobId}` : `/jobs/${jobId}`;
  await gotoWithRetry(page, path);
}

/**
 * Customer authorizes the seeded job through the mock PayPal button
 * (NEXT_PUBLIC_PAYPAL_MOCK=1) and waits for the hold to be visible.
 */
export async function authorizeJobWithMock(page: Page, jobId: string): Promise<void> {
  await openJob(page, jobId, 'customer');
  const status = page.getByTestId('job-status');
  await expect(status).toHaveAttribute('data-status', 'CREATED', { timeout: 30_000 });

  await page.getByTestId('paypal-mock-approve').click();
  await expect(page.getByTestId('funds-held')).toBeVisible({ timeout: 30_000 });
  await expect(status).toHaveAttribute('data-status', 'AUTHORIZED', { timeout: 30_000 });
}

/**
 * Worker view: verifies the liveness code is shown, uploads the two images and submits.
 * Waits for the customer `/jobs/<id>` redirect so the in-flight submit POST is not
 * aborted by the next navigation (note `/worker/jobs/<id>` also contains `/jobs/<id>`).
 */
export async function uploadEvidenceAndSubmit(
  page: Page,
  jobId: string,
  beforeFile: string,
  afterFile: string,
): Promise<string> {
  await openJob(page, jobId, 'worker');
  const livenessCode = page.getByTestId('liveness-code');
  await expect(livenessCode).toHaveCount(1, { timeout: 30_000 });
  await expect(livenessCode).toContainText(/\d{4}/);
  const code = (await livenessCode.textContent())?.match(/\d{4}/)?.[0] ?? '';

  await page.getByTestId('dropzone-before').setInputFiles(beforeFile);
  await page.getByTestId('dropzone-after').setInputFiles(afterFile);
  const submit = page.getByTestId('submit-evidence');
  await expect(submit).toBeEnabled({ timeout: 20_000 });

  await Promise.all([
    page.waitForURL((url) => /^\/jobs\/[^/?#]+$/.test(url.pathname), { timeout: 45_000 }),
    submit.click(),
  ]);
  return code;
}
