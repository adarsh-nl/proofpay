import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { JobView } from '@/components/job/JobView';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api-client';
import { parseRole, ROLE_COOKIE } from '@/lib/role';
import { serverApiOptions } from '@/lib/server-request';
import type { Job } from '@/shared/contracts';

export const dynamic = 'force-dynamic';

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const role = parseRole(cookieStore.get(ROLE_COOKIE)?.value);

  let job: Job | null = null;
  let errorMessage: string | null = null;
  try {
    job = await api.getJob(id, await serverApiOptions());
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      notFound();
    }
    errorMessage =
      error instanceof ApiClientError ? error.message : 'Could not load this job from the API.';
  }

  if (!job) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">This job could not be loaded</h1>
        <p className="mt-2 text-muted-foreground">{errorMessage}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Check that the ProofPay server is running and that the job id is correct.
        </p>
        <div className="mt-6 flex gap-3">
          <Button asChild>
            <Link href="/">Back to the landing page</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/jobs/${encodeURIComponent(id)}`}>Try again</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <JobView key={`${job.id}:${job.updatedAt}`} initialJob={job} role={role} />
    </div>
  );
}
