'use client';

import { useState } from 'react';

import type { Job } from '@/shared/contracts';

import { CriterionCard } from './CriterionCard';
import { EvidenceViewer } from './EvidenceViewer';
import { FlagsPanel } from './FlagsPanel';
import { VerificationSummary } from './VerificationSummary';

/**
 * The C2 verification slot: summary, evidence photos with the AI boxes, the
 * per-criterion verdict cards and the forensics flags. Hovering a card highlights
 * its boxes in the viewer.
 */
export function VerificationSection({ job }: { job: Job }) {
  const verification = job.latestVerification;
  const [activeCriterionId, setActiveCriterionId] = useState<string | null>(null);

  if (!verification) return null;

  const criteriaById = new Map(job.criteria.map((criterion) => [criterion.id, criterion]));

  return (
    <section className="flex flex-col gap-4" aria-labelledby="verification-heading">
      <div>
        <h2 id="verification-heading" className="text-xl font-semibold tracking-tight">
          AI verification
        </h2>
        <p className="text-sm text-muted-foreground">
          Every acceptance criterion is checked against the before/after photos. Evidence boxes show
          what the vision model looked at.
        </p>
      </div>

      <VerificationSummary verification={verification} />

      <EvidenceViewer
        jobId={job.id}
        report={verification.report}
        activeCriterionId={activeCriterionId}
      />

      <div className="grid gap-3 md:grid-cols-2">
        {verification.report.verdicts.map((verdict) => (
          <CriterionCard
            key={verdict.criterionId}
            criterion={criteriaById.get(verdict.criterionId)}
            verdict={verdict}
            active={activeCriterionId === verdict.criterionId}
            onHoverChange={setActiveCriterionId}
          />
        ))}
      </div>

      <FlagsPanel flags={verification.forensics.flags} />

      {verification.decision.reasons.length > 0 ? (
        <div className="rounded-lg border bg-muted/30 p-4">
          <h3 className="text-sm font-semibold">Why this outcome</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {verification.decision.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
