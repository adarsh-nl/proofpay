import { cookies } from 'next/headers';
import Link from 'next/link';

import { WorkerEvidenceForm } from '@/components/evidence/WorkerEvidenceForm';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api-client';
import { parseRole, ROLE_COOKIE } from '@/lib/role';
import { serverApiOptions } from '@/lib/server-request';
import type { EvidenceItem, Job } from '@/shared/contracts';

export const dynamic = 'force-dynamic';

export default async function WorkerJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const role = parseRole(cookieStore.get(ROLE_COOKIE)?.value);

  if (role !== 'worker') {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Switch to the worker role</h1>
        <p className="text-muted-foreground">
          Photo evidence is uploaded by the worker. The customer and reviewer do not use this page.
        </p>
        <Button asChild className="w-fit">
          <Link href="/?as=worker">Switch to the worker role</Link>
        </Button>
      </div>
    );
  }

  let job: Job | null = null;
  let evidence: EvidenceItem[] = [];
  let message = 'Could not load this job.';
  try {
    const options = await serverApiOptions();
    job = await api.getJob(id, options);
    evidence = await api.listEvidence(id, options);
  } catch (error) {
    message = error instanceof ApiClientError ? error.message : message;
  }

  if (!job) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-3 px-4 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">This job could not be loaded</h1>
        <p role="alert" data-testid="toast-error" className="text-sm text-destructive">
          {message}
        </p>
        <Button asChild variant="outline" className="w-fit">
          <Link href="/">Back to ProofPay</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <WorkerEvidenceForm job={job} initialEvidence={evidence} />
    </div>
  );
}
