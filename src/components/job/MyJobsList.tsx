import { ClipboardList } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiClientError } from '@/lib/api-client';
import { formatMoney, formatRelativeTime } from '@/lib/format';
import { serverApiOptions } from '@/lib/server-request';
import { statusClass, statusLabel } from '@/lib/status';
import type { JobListItem } from '@/shared/contracts';

/**
 * "My jobs" list (MANUAL §8 #2) — makes the seeded demo jobs reachable by clicking
 * instead of typing ids, and gives the landing page a real empty state.
 */
export async function MyJobsList() {
  let jobs: JobListItem[] = [];
  let error: string | null = null;

  try {
    jobs = await api.listJobs(await serverApiOptions());
  } catch (cause) {
    error = cause instanceof ApiClientError ? cause.message : 'Could not load the job list.';
  }

  return (
    <section className="pb-16" aria-labelledby="jobs-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="jobs-heading" className="text-2xl font-semibold tracking-tight">
            Jobs in this demo
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The seeded demo jobs and anything created in this sandbox. Open one to see the escrow
            from the customer side.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/customer/new">Create a job</Link>
        </Button>
      </div>

      {error ? (
        <p
          role="alert"
          data-testid="toast-error"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error} Check that the ProofPay server is running.
        </p>
      ) : jobs.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed p-8 text-center">
          <ClipboardList aria-hidden="true" className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-2 font-medium">No jobs yet. Create one.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            A job starts in CREATED; the customer then holds the payment with PayPal.
          </p>
          <Button asChild className="mt-4">
            <Link href="/customer/new">Create your first job</Link>
          </Button>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link
                href={`/jobs/${job.id}`}
                data-testid="job-list-row"
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{job.title}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{job.id}</span>
                </span>
                <Badge
                  variant="outline"
                  data-status={job.status}
                  className={statusClass(job.status)}
                >
                  {statusLabel(job.status)}
                </Badge>
                <span className="font-mono text-sm">{formatMoney(job.amount)}</span>
                <span className="text-xs text-muted-foreground">
                  updated {formatRelativeTime(job.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MyJobsListSkeleton() {
  return (
    <div className="flex flex-col gap-2 pb-16" aria-label="Loading jobs">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}
