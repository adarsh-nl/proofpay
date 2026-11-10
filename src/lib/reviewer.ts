'use client';

import { ApiClientError, type ApiRequestOptions } from '@/lib/api-client';

/**
 * Reviewer console passcode handling (C8 / MANUAL §8): the backend requires the
 * `x-reviewer-passcode` header when `REVIEWER_PASSCODE` is set. The UI prompts once
 * and keeps the code in `sessionStorage` — never in a cookie or the URL.
 *
 * The header name mirrors `REVIEWER_PASSCODE_HEADER` in `src/server/http/role.ts`
 * (server code cannot be imported into the browser bundle).
 */
export const REVIEWER_PASSCODE_HEADER = 'x-reviewer-passcode';

const STORAGE_KEY = 'pp_reviewer_passcode';

export function getStoredPasscode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storePasscode(passcode: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, passcode);
  } catch {
    // sessionStorage can be unavailable in private modes — the request will 403 and re-prompt.
  }
}

export function clearStoredPasscode(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Request options carrying the stored reviewer passcode, if any. */
export function reviewerRequestOptions(): ApiRequestOptions | undefined {
  const passcode = getStoredPasscode();
  if (!passcode) return undefined;
  return { headers: { [REVIEWER_PASSCODE_HEADER]: passcode } };
}

export function isPasscodeRequired(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) return false;
  if (error.code === 'REVIEWER_PASSCODE_REQUIRED') return true;
  return error.status === 403 && /passcode/i.test(error.message);
}

/** A route that has not been deployed yet (e.g. the T14 evidence-pack endpoint). */
export function isEndpointMissing(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 404 || error.status === 405);
}
