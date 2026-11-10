'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import { fromCents, toCents } from '@/shared/money';
import {
  SettlementProposalSchema,
  type Job,
  type Money,
  type SettlementProposal,
} from '@/shared/contracts';

export type TimelineRow = {
  key: string;
  text: string;
  copyValue?: string;
};

function latestProposal(job: Job): SettlementProposal | undefined {
  for (let index = job.events.length - 1; index >= 0; index -= 1) {
    const event = job.events[index];
    if (event?.type !== 'AGENT_MESSAGE') continue;
    const parsed = SettlementProposalSchema.safeParse(event.data);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

function subtractMoney(total: Money, part: Money): Money | null {
  if (total.currency !== part.currency) return null;
  const left = toCents(total.value) - toCents(part.value);
  if (left <= 0) return null;
  return { currency: total.currency, value: fromCents(left) };
}

/** Rows for the money story: hold, AI verdict, capture, release, void, refund. */
export function buildTimelineRows(job: Job): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const payment = job.payment;
  const held = payment?.authorized ?? job.amount;

  if (payment?.authorizationId || payment?.orderId) {
    const id = payment.authorizationId ?? payment.orderId ?? '';
    rows.push({
      key: 'held',
      text: `Held ${formatMoney(held)} (PayPal authorization ${id})`,
      copyValue: id,
    });
  }

  if (job.latestVerification) {
    const scored = job.criteria.filter((criterion) => criterion.id !== 'cL');
    const basis = scored.length > 0 ? scored : job.criteria;
    const pass = basis.filter((criterion) =>
      job.latestVerification?.report.verdicts.some(
        (verdict) => verdict.criterionId === criterion.id && verdict.verdict === 'PASS',
      ),
    ).length;
    rows.push({ key: 'verified', text: `AI verified ${pass}/${basis.length}` });
  }

  if (payment && toCents(payment.captured.value) > 0) {
    const captureId = payment.captureIds[0];
    rows.push({
      key: 'captured',
      text: captureId
        ? `Captured ${formatMoney(payment.captured)} (capture ${captureId})`
        : `Captured ${formatMoney(payment.captured)}`,
      copyValue: captureId,
    });
    const authorized = payment.authorized ?? job.amount;
    const released = subtractMoney(authorized, payment.captured);
    if (released) {
      rows.push({ key: 'released', text: `Released ${formatMoney(released)}` });
    }
  } else {
    const proposal = latestProposal(job);
    if (proposal && job.status === 'PARTIAL') {
      rows.push({
        key: 'proposed-capture',
        text: `Proposed capture ${formatMoney(proposal.captureAmount)}`,
      });
      rows.push({
        key: 'proposed-release',
        text: `Would release ${formatMoney(proposal.releaseAmount)}`,
      });
    }
  }

  if (job.status === 'VOIDED') {
    rows.push({ key: 'voided', text: 'Voided' });
  }
  if (payment && toCents(payment.refunded.value) > 0) {
    rows.push({ key: 'refunded', text: `Refunded ${formatMoney(payment.refunded)}` });
  }

  return rows;
}

function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
        });
      }}
    >
      {copied ? 'Copied' : 'Copy id'}
    </Button>
  );
}

export function MoneyTimeline({ job }: { job: Job }) {
  const rows = buildTimelineRows(job);
  const payment = job.payment;
  const ids = [payment?.orderId, payment?.authorizationId, ...((payment?.captureIds) ?? [])].filter(
    (id): id is string => Boolean(id),
  );

  if (rows.length === 0 && ids.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4" aria-label="Money timeline">
      <h2 className="text-lg font-semibold tracking-tight">Money timeline</h2>
      <ol className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.key}
            data-testid="timeline-event"
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            <span>{row.text}</span>
            {row.copyValue ? <CopyId value={row.copyValue} /> : null}
          </li>
        ))}
      </ol>
      {ids.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          PayPal sandbox activity:{' '}
          <span>https://www.sandbox.paypal.com/activity</span>
          {ids.map((id) => (
            <span key={id}> · {id}</span>
          ))}
        </p>
      ) : null}
    </section>
  );
}
