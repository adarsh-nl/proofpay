'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { api, ApiClientError } from '@/lib/api-client';
import { POLL_INTERVAL_MS } from '@/lib/constants';
import type { Role } from '@/lib/role';
import type { Job } from '@/shared/contracts';

import { CheckoutPanel } from './CheckoutPanel';
import { CriteriaEditor } from './CriteriaEditor';
import { FundsHeldCard } from './FundsHeldCard';
import { StatusHeader } from './StatusHeader';

/** C2: full job page composition, in slot order. Later tasks replace the
 *  placeholder comments below with one import + one JSX line each. */
const POLLING_STATUSES: ReadonlySet<Job['status']> = new Set(['EVIDENCE_SUBMITTED', 'VERIFYING']);
const FIXTURE_MODE = process.env.NEXT_PUBLIC_USE_FIXTURES === '1';

export function JobView({ initialJob, role }: { initialJob: Job; role: Role }) {
  const [job, setJob] = useState<Job>(initialJob);
  const [pollError, setPollError] = useState<string | null>(null);

  // The server page passes a `key` built from job.id + updatedAt, so a server
  // refresh remounts this view with the fresh initial job (no setState in effect).

  // C2: poll every 2 s only while verification is running.
  useEffect(() => {
    if (FIXTURE_MODE) return;
    if (!POLLING_STATUSES.has(job.status)) return;

    let cancelled = false;
    let failures = 0;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const next = await api.getJob(job.id);
          if (cancelled) return;
          failures = 0;
          setPollError(null);
          setJob(next);
        } catch (cause) {
          if (cancelled) return;
          failures += 1;
          if (failures === 3) {
            const message =
              cause instanceof ApiClientError ? cause.message : 'Live updates paused.';
            setPollError(message);
            toast.error(message);
          }
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job.id, job.status]);

  const isCreated = job.status === 'CREATED';

  return (
    <div className="flex flex-col gap-6">
      <StatusHeader job={job} />

      {role === 'worker' ? (
        <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          You are viewing the customer page as the worker.{' '}
          <Link className="underline" href={`/worker/jobs/${job.id}`}>
            Open the evidence upload page
          </Link>
          .
        </p>
      ) : null}

      {isCreated ? <CriteriaEditor job={job} onUpdated={setJob} /> : null}
      {isCreated && role === 'customer' ? <CheckoutPanel job={job} onUpdated={setJob} /> : null}
      {isCreated && role !== 'customer' ? (
        <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          Switch to the customer role to hold the payment with PayPal (use the customer role card on
          the landing page).
        </p>
      ) : null}
      {!isCreated && job.payment ? <FundsHeldCard job={job} /> : null}
      {/* TODO(F05): <VerificationSection job={job} /> — when job.latestVerification */}
      {/* TODO(F06): <SettlementPanel job={job} role={role} onUpdated={setJob} /> */}
      {/* TODO(F06): <MoneyTimeline job={job} /> */}

      {pollError ? (
        <p role="alert" data-testid="toast-error" className="text-sm text-destructive">
          {pollError}
        </p>
      ) : null}
    </div>
  );
}
