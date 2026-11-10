import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { StatusHeader } from '@/components/job/StatusHeader';
import { EvidencePackPanel } from '@/components/review/EvidencePackPanel';
import { ReviewDecisionForm } from '@/components/review/ReviewDecisionForm';
import { VerificationSection } from '@/components/verification/VerificationSection';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiClientError } from '@/lib/api-client';
import { parseRole, ROLE_COOKIE } from '@/lib/role';
import { serverApiOptions } from '@/lib/server-request';
import { statusLabel } from '@/lib/status';
import type { Job } from '@/shared/contracts';

export const dynamic = 'force-dynamic';

export default async function ReviewerJobPage({ params }: { params: Promise<{ id: string }> }) {
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
        <Button asChild className="mt-6">
          <Link href="/reviewer">Back to the review queue</Link>
        </Button>
      </div>
    );
  }

  const isReviewer = role === 'reviewer';

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <Link href="/reviewer" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        ← Reviewer queue
      </Link>

      <StatusHeader job={job} />

      {!isReviewer ? (
        <Card>
          <CardHeader>
            <CardTitle>Switch to the reviewer role</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Decisions can only be submitted by a reviewer. Switch the demo role to reviewer.
            </p>
            <Button asChild className="w-fit">
              <Link href="/?as=reviewer">Switch to the reviewer role</Link>
            </Button>
          </CardContent>
        </Card>
      ) : job.status === 'HUMAN_REVIEW' ? (
        <ReviewDecisionForm job={job} />
      ) : (
        <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          This job is not waiting for review anymore (status: {statusLabel(job.status)}).
        </p>
      )}

      {job.latestVerification ? (
        <VerificationSection job={job} />
      ) : (
        <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          No AI verification record was stored for this job yet.
        </p>
      )}

      <EvidencePackPanel jobId={job.id} />
    </div>
  );
}
