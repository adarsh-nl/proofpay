import 'server-only';

import { cookies } from 'next/headers';

import type { ApiRequestOptions } from '@/lib/api-client';

/**
 * Build the request options for an API call made from a Server Component:
 * an absolute base URL (Node `fetch` needs one) plus the browser's cookies, so
 * the backend sees the same `pp_role` / passcode state as the client.
 */
export async function serverApiOptions(): Promise<ApiRequestOptions> {
  const cookieStore = await cookies();
  const cookie = cookieStore
    .getAll()
    .map((entry) => `${entry.name}=${entry.value}`)
    .join('; ');
  const baseUrl =
    process.env.APP_BASE_URL ??
    (process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3000');

  return {
    baseUrl,
    headers: cookie ? { cookie } : undefined,
  };
}
