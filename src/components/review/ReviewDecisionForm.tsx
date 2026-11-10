'use client';

import { CheckCircle2, ScaleIcon, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { PasscodePrompt } from '@/components/review/PasscodePrompt';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, ApiClientError } from '@/lib/api-client';
import { isPasscodeRequired, reviewerRequestOptions } from '@/lib/reviewer';
import { toCents } from '@/shared/money';
import type { Job, ReviewDecision } from '@/shared/contracts';
import { ReviewBodySchema } from '@/shared/contracts';

const DECISIONS: { value: ReviewDecision; label: string; testId: string }[] = [
  { value: 'APPROVE', label: 'Approve full capture', testId: 'review-decision-approve' },
  { value: 'PARTIAL', label: 'Part-pay', testId: 'review-decision-partial' },
  { value: 'REJECT', label: 'Reject & void', testId: 'review-decision-reject' },
];

/** Reviewer decision form (MANUAL §8 #13) for a HUMAN_REVIEW job. */
export function ReviewDecisionForm({ job }: { job: Job }) {
  const router = useRouter();
  const authorised = job.payment?.authorized?.value ?? job.amount.value;
  const suggested = job.latestVerification?.decision.captureAmount?.value ?? authorised;
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [amount, setAmount] = useState(suggested);
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passcodeOpen, setPasscodeOpen] = useState(false);

  function reportError(message: string) {
    setError(message);
    toast.error(message);
  }

  function amountError(): string | null {
    if (decision !== 'PARTIAL') return null;
    let cents: number;
    try {
      cents = toCents(amount.trim());
    } catch {
      return 'Enter a valid amount, e.g. 96.00';
    }
    if (cents <= 0) return 'The amount must be more than zero.';
    if (cents > toCents(authorised)) {
      return `The amount cannot exceed the ${authorised} ${job.amount.currency} held by PayPal.`;
    }
    return null;
  }

  async function submit() {
    if (!decision) {
      reportError('Choose approve, part-pay or reject.');
      return;
    }
    const body = {
      decision,
      notes: notes.trim(),
      ...(decision === 'PARTIAL'
        ? { amount: { currency: job.amount.currency, value: amount.trim() } }
        : {}),
    };
    const parsed = ReviewBodySchema.safeParse(body);
    if (!parsed.success) {
      reportError(parsed.error.issues[0]?.message ?? 'Check the decision form.');
      return;
    }
    const rangeError = amountError();
    if (rangeError) {
      reportError(rangeError);
      return;
    }

    setPending(true);
    setError(null);
    try {
      await api.review(job.id, parsed.data, reviewerRequestOptions());
      toast.success(
        decision === 'REJECT'
          ? 'Rejected — the PayPal hold was voided'
          : decision === 'PARTIAL'
            ? 'Part-payment captured'
            : 'Approved — full capture sent to PayPal',
      );
      router.refresh();
      router.push('/reviewer');
    } catch (cause) {
      if (isPasscodeRequired(cause)) {
        setPasscodeOpen(true);
      } else {
        reportError(
          cause instanceof ApiClientError ? cause.message : 'Could not submit the review decision.',
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your decision</CardTitle>
        <CardDescription>
          The AI escalated this job. You can capture in full, capture part of the held amount, or
          reject and release the hold. Nothing moves until you submit.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {DECISIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={decision === option.value ? 'default' : 'outline'}
              onClick={() => setDecision(option.value)}
              data-testid={option.testId}
              aria-pressed={decision === option.value}
            >
              {option.value === 'APPROVE' ? (
                <CheckCircle2 aria-hidden="true" className="mr-1 size-4" />
              ) : option.value === 'PARTIAL' ? (
                <ScaleIcon aria-hidden="true" className="mr-1 size-4" />
              ) : (
                <XCircle aria-hidden="true" className="mr-1 size-4" />
              )}
              {option.label}
            </Button>
          ))}
        </div>

        {decision === 'PARTIAL' ? (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            <span>Amount to capture ({job.amount.currency})</span>
            <Input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              className="max-w-40"
            />
            <span className="text-xs font-normal text-muted-foreground">
              At most {authorised} {job.amount.currency} is held by PayPal.
            </span>
          </label>
        ) : null}

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          <span>Notes (shown in the evidence pack)</span>
          <textarea
            data-testid="review-notes"
            className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            value={notes}
            maxLength={2000}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What did you check, and why this decision?"
          />
        </label>

        {error ? (
          <p role="alert" data-testid="toast-error" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end border-t pt-4">
          <Button onClick={() => void submit()} disabled={pending || !decision} data-testid="review-submit">
            {pending ? 'Submitting…' : 'Submit decision'}
          </Button>
        </div>
      </CardContent>

      <PasscodePrompt open={passcodeOpen} onOpenChange={setPasscodeOpen} onSaved={() => void submit()} />
    </Card>
  );
}
