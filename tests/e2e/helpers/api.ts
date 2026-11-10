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
  await page.goto(`/?as=${role}`);
  await page.waitForFunction(
    (expected) => document.cookie.split(';').some((part) => part.trim().startsWith(`pp_role=${expected}`)),
    role,
  );
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
  return (await response.json()) as Job;
}

/** `GET /api/jobs` list. */
export async function fetchJobs(request: APIRequestContext): Promise<JobListItem[]> {
  const response = await request.get('/api/jobs');
  expect(response.ok(), `GET /api/jobs -> ${response.status()}`).toBeTruthy();
  return (await response.json()) as JobListItem[];
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
