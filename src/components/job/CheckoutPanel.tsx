'use client';

import { ShieldCheck } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiClientError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Job } from '@/shared/contracts';

const PayPalCheckoutButtons = dynamic(
  () => import('./PayPalCheckoutButtons').then((module) => module.PayPalCheckoutButtons),
  {
    ssr: false,
    loading: () => <Skeleton className="h-11 w-full" aria-label="Loading PayPal buttons" />,
  },
);

const MOCK_MODE = process.env.NEXT_PUBLIC_PAYPAL_MOCK === '1';

export interface CheckoutPanelProps {
  job: Job;
  onUpdated: (job: Job) => void;
}

/**
 * CREATED job → PayPal checkout (C2 slot 3). Real PayPal buttons, or the
 * "Simulate PayPal approval (mock)" button when `NEXT_PUBLIC_PAYPAL_MOCK=1`
 * (C11/R10 — no PayPal SDK is loaded in mock mode).
 */
export function CheckoutPanel({ job, onUpdated }: CheckoutPanelProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reportError(message: string) {
    setError(message);
    toast.error(message);
  }

  async function simulateApproval() {
    setPending(true);
    setError(null);
    try {
      const { orderId } = await api.createOrder({ jobId: job.id });
      const updated = await api.authorize(orderId, { jobId: job.id });
      onUpdated(updated);
      toast.success('PayPal approval simulated — funds are now held');
    } catch (cause) {
      reportError(
        cause instanceof ApiClientError ? cause.message : 'Could not simulate the PayPal approval.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Hold the payment with PayPal</CardTitle>
          <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-800">
            PayPal Sandbox
          </Badge>
          {MOCK_MODE ? (
            <Badge variant="secondary" className="bg-amber-100 text-amber-900">
              Mock mode
            </Badge>
          ) : null}
        </div>
        <CardDescription>
          Authorize {formatMoney(job.amount)} with PayPal. The money is held by PayPal, not charged.
          It is captured only after the photos are verified (and, for a partial capture, after you
          approve the amount).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <ShieldCheck aria-hidden="true" className="size-4 text-emerald-700" />
            Held by PayPal — nothing is charged yet
          </p>
          <p className="mt-1">
            You stay in control: if the proof is not verified you can release (void) the hold.
          </p>
        </div>

        {MOCK_MODE ? (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              size="lg"
              onClick={simulateApproval}
              disabled={pending}
              data-testid="paypal-mock-approve"
            >
              {pending ? 'Simulating…' : 'Simulate PayPal approval (mock)'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Mock mode is on (`NEXT_PUBLIC_PAYPAL_MOCK=1`): no PayPal SDK and no real money. The
              same two API calls run as with the real buttons.
            </p>
          </div>
        ) : (
          <PayPalCheckoutButtons
            jobId={job.id}
            onAuthorized={(updated) => {
              setError(null);
              onUpdated(updated);
              toast.success('Funds held by PayPal');
            }}
            onError={reportError}
          />
        )}

        {error ? (
          <p role="alert" data-testid="toast-error" className={cn('text-sm text-destructive')}>
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
