'use client';

import { ArrowRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { PasscodePrompt } from '@/components/review/PasscodePrompt';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, ApiClientError } from '@/lib/api-client';
import { formatMoney, formatRelativeTime } from '@/lib/format';
import { isPasscodeRequired, reviewerRequestOptions } from '@/lib/reviewer';
import type { Job, JobListItem } from '@/shared/contracts';

interface QueueRow {
  job: JobListItem;
  detail: Job | null;
}

function reviewReason(detail: Job | null): string {
  const verification = detail?.latestVerification;
  const highFlag = verification?.forensics.flags.find((flag) => flag.level === 'HIGH');
  if (highFlag) {
    return `${highFlag.code.replaceAll('_', ' ').toLowerCase()}: ${highFlag.message}`;
  }
  const firstReason = verification?.decision.reasons[0];
  if (firstReason) return firstReason;
  return 'Evidence needs a human decision before any money moves.';
}

/** Reviewer queue (MANUAL §8 #17): jobs in HUMAN_REVIEW with why + age. */
export function ReviewerQueue() {
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [passcodeOpen, setPasscodeOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const jobs = await api.reviewQueue(reviewerRequestOptions());
        const details = await Promise.all(
          jobs.map(async (job) => {
            try {
              return await api.getJob(job.id, reviewerRequestOptions());
            } catch {
              return null;
            }
          }),
        );
        if (cancelled) return;
        setRows(jobs.map((job, index) => ({ job, detail: details[index] ?? null })));
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        if (isPasscodeRequired(cause)) {
          setPasscodeOpen(true);
        } else {
          setError(
            cause instanceof ApiClientError ? cause.message : 'Could not load the review queue.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function reload() {
    setRows(null);
    setReloadToken((token) => token + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Every job here was escalated by the AI (low confidence, a failed required check or a fraud
          flag). A person decides before PayPal moves money.
        </p>
        <Button variant="outline" size="sm" onClick={reload}>
          <RefreshCw aria-hidden="true" className="mr-1 size-3.5" /> Refresh
        </Button>
      </div>

      {rows === null && !error ? (
        <div className="flex flex-col gap-2" aria-label="Loading review queue">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : error ? (
        <p role="alert" data-testid="toast-error" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </p>
      ) : rows && rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">No jobs waiting for review</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Escalated jobs appear here automatically. Run the delivery duplicate flow to create one.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead className="hidden sm:table-cell">Why a human</TableHead>
              <TableHead>Age</TableHead>
              <TableHead className="text-right">Open</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows?.map(({ job, detail }) => (
              <TableRow key={job.id} data-testid="reviewer-queue-row" className="align-top">
                <TableCell>
                  <Link
                    href={`/reviewer/jobs/${job.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {job.title}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">{job.id}</p>
                </TableCell>
                <TableCell className="font-mono">{formatMoney(job.amount)}</TableCell>
                <TableCell className="hidden max-w-md text-sm text-muted-foreground sm:table-cell">
                  {reviewReason(detail)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{formatRelativeTime(job.updatedAt)}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/reviewer/jobs/${job.id}`}>
                      Review <ArrowRight aria-hidden="true" className="ml-1 size-3.5" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <PasscodePrompt
        open={passcodeOpen}
        onOpenChange={setPasscodeOpen}
        onSaved={reload}
      />
    </div>
  );
}
