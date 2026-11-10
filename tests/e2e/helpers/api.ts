/**
 * Typed API helpers for the Playwright suite.
 *
 * The e2e specs drive the browser through the UI (with the C3 `data-testid` contract),
 * and use these helpers only to look up a job id / poll a status while the app is being
 * driven — e.g. "did the verification finish?" — so a test never has to sleep blindly.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';

import type { Job, JobListItem } from '../../../src/shared/contracts';

export type EscrowStatus =
  | 'CREATED'
  | 'AUTHORIZED'
  | 'EVIDENCE_SUBMITTED'
  | 'VERIFYING'
  | 'APPROVED'
  | 'PARTIAL'
  | 'REJECTED'
  | 'HUMAN_REVIEW'
  | 'CAPTURED'
  | 'VOIDED'
  | 'REFUNDED';

/** Switch the demo role. C1: the role switch is a URL parameter backed by the pp_role cookie. */
export async function selectRole(page: Page, role: 'customer' | 'worker' | 'reviewer'): Promise<void> {
  await gotoWithRetry(page, `/?as=${role}`);
  await page.waitForFunction(
    (expected) => document.cookie.split(';').some((part) => part.trim().startsWith(`pp_role=${expected}`)),
    role,
  );
  // The role setter hydrates and calls router.refresh(); give that navigation time to
  // finish so the next page.goto is not aborted by a competing navigation.
  await page.waitForLoadState('load').catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
}

/**
 * `page.goto` with a couple of retries: the landing page's role setter can issue a
 * `router.refresh()` right as the next navigation starts, which aborts it (ERR_ABORTED).
 */
export async function gotoWithRetry(page: Page, url: string, attempts = 3): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      await page.waitForTimeout(300);
    }
  }
}

/**
 * Put the app back to the three seeded demo jobs (no payments, no photos) through
 * `POST /api/dev/reset`. Every spec file calls this in `beforeAll`, so the files do not
 * depend on the order they run in: without it, a spec that settles `demo-cleaning` or
 * leaves photos behind makes the next spec fail (job no longer CREATED, duplicate photo).
 *
 * The route only exists when the server runs with `DEMO_RESET_ENABLED=1` (the managed
 * e2e server sets it). Against a server without it (for example the hosted demo) the
 * route answers 404 and the reset is skipped.
 */
export async function resetDemoData(request: APIRequestContext): Promise<boolean> {
  const passcode = process.env.REVIEWER_PASSCODE;
  const response = await request.post('/api/dev/reset', {
    headers: {
      cookie: 'pp_role=reviewer',
      ...(passcode ? { 'x-reviewer-passcode': passcode } : {}),
    },
  });
  if (response.status() === 404) return false;
  expect(response.ok(), `POST /api/dev/reset -> ${response.status()}`).toBeTruthy();
  return true;
}

/** The current job id from a `/jobs/<id>` URL. */
export function jobIdFromUrl(page: Page): string {
  const match = page.url().match(/\/jobs\/([^/?#]+)/);
  if (!match?.[1]) throw new Error(`not on a job page: ${page.url()}`);
  return decodeURIComponent(match[1]);
}

/** `GET /api/jobs/:id` (typed through the shared contract). */
export async function fetchJob(request: APIRequestContext, jobId: string): Promise<Job> {
  const response = await request.get(`/api/jobs/${jobId}`);
  expect(response.ok(), `GET /api/jobs/${jobId} -> ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { job: Job };
  return body.job;
}

/** `GET /api/jobs` list. */
export async function fetchJobs(request: APIRequestContext): Promise<JobListItem[]> {
  const response = await request.get('/api/jobs');
  expect(response.ok(), `GET /api/jobs -> ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { jobs: JobListItem[] };
  return body.jobs;
}

/**
 * Poll `GET /api/jobs/:id` until the status is one of `expected`.
 * Returns the job so the test can assert amounts/ids on the final state.
 */
export async function waitForJobStatus(
  request: APIRequestContext,
  jobId: string,
  expected: EscrowStatus[],
  timeoutMs = 30_000,
): Promise<Job> {
  const deadline = Date.now() + timeoutMs;
  let last: Job | null = null;
  while (Date.now() < deadline) {
    last = await fetchJob(request, jobId);
    if (expected.includes(last.status as EscrowStatus)) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `job ${jobId} did not reach ${expected.join('|')} within ${timeoutMs} ms (last status: ${last?.status ?? 'none'})`,
  );
}
