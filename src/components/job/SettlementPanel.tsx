'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiClientError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import type { Role } from '@/lib/role';
import { isTerminal } from '@/shared/escrow';
import { SettlementProposalSchema, type Job, type SettlementProposal } from '@/shared/contracts';

function latestProposal(job: Job): SettlementProposal | undefined {
  for (let index = job.events.length - 1; index >= 0; index -= 1) {
    const event = job.events[index];
    if (event?.type !== 'AGENT_MESSAGE') continue;
    // The settlement agent stores `{ proposal, explanation, model }` in the event
    // data; the backend's findLatestProposal unwraps the same way. Accept both the
    // nested and the bare settlement-proposal payload shapes (MANUAL §8).
    const data: unknown = event.data;
    const nested =
      typeof data === 'object' && data !== null
        ? (data as { proposal?: unknown }).proposal
        : undefined;
    for (const candidate of [data, nested]) {
      const parsed = SettlementProposalSchema.safeParse(candidate);
      if (parsed.success) return parsed.data;
    }
  }
  return undefined;
}

const OUTCOME_COPY: Partial<Record<Job['status'], string>> = {
  CAPTURED: 'PayPal captured the approved amount. The job is complete.',
  VOIDED: 'The PayPal hold was released. Nothing was captured.',
  REFUNDED: 'PayPal refunded the captured amount.',
  CANCELLED: 'This job was cancelled before PayPal held the funds.',
};

export function SettlementPanel({
  job,
  role,
  onUpdated,
}: {
  job: Job;
  role: Role;
  onUpdated: (job: Job) => void;
}) {
  const proposal = latestProposal(job);
  const [reason, setReason] = useState('');
  const [declineOpen, setDeclineOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAccept = role === 'customer' && job.status === 'PARTIAL' && proposal;
  const canDecline = (role === 'customer' || role === 'worker') && job.status === 'PARTIAL' && proposal;
  const canVoid =
    role === 'customer' && (job.status === 'AUTHORIZED' || job.status === 'REJECTED');

  async function run(action: () => Promise<Job>) {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await action());
      setDeclineOpen(false);
    } catch (caught) {
      const message = caught instanceof ApiClientError ? caught.message : 'That action failed.';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  if (!proposal && !canVoid && !isTerminal(job.status)) return null;

  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4" aria-label="Settlement">
      <h2 className="text-lg font-semibold tracking-tight">Settlement</h2>

      {proposal ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{proposal.explanation}</p>
          <p className="text-sm font-medium">
            Capture {formatMoney(proposal.captureAmount)} · release {formatMoney(proposal.releaseAmount)}
          </p>
        </div>
      ) : null}

      {isTerminal(job.status) ? (
        <p className="text-sm">{OUTCOME_COPY[job.status]}</p>
      ) : null}

      {canAccept || canDecline ? (
        <div className="flex flex-wrap gap-2">
          {canAccept ? (
            <Button
              type="button"
              data-testid="accept-proposal"
              disabled={busy}
              onClick={() =>
                void run(() => api.acceptProposal(job.id, { proposalId: proposal.proposalId }))
              }
            >
              Accept proposal
            </Button>
          ) : null}
          {canDecline ? (
            <Button
              type="button"
              variant="outline"
              data-testid="decline-proposal"
              disabled={busy}
              onClick={() => setDeclineOpen(true)}
            >
              Decline
            </Button>
          ) : null}
        </div>
      ) : null}

      {canVoid ? (
        <Button
          type="button"
          variant="outline"
          data-testid="cancel-hold"
          disabled={busy}
          onClick={() =>
            void run(() =>
              api.voidJob(job.id, { reason: 'Customer cancelled the PayPal hold.' }),
            )
          }
        >
          Cancel & release hold
        </Button>
      ) : null}

      {error ? (
        <p role="alert" data-testid="toast-error" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline this proposal</DialogTitle>
            <DialogDescription>
              The PayPal hold stays in place and a reviewer decides what happens next.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why should this proposal be declined?"
            aria-label="Reason for declining the proposal"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || reason.trim().length < 3 || !proposal}
              onClick={() => {
                if (!proposal) return;
                void run(() =>
                  api.declineProposal(job.id, {
                    proposalId: proposal.proposalId,
                    reason: reason.trim(),
                  }),
                );
              }}
            >
              Decline proposal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
