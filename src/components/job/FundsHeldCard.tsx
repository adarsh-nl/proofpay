import { Clock, Lock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, formatMoney, formatRelativeTime } from '@/lib/format';
import type { Job } from '@/shared/contracts';

const MOCK_MODE = process.env.NEXT_PUBLIC_PAYPAL_MOCK === '1';

/**
 * AUTHORIZED and later → the money is held by PayPal. Shows the authorization id
 * and both deadlines (C2 slot 4). `data-testid="funds-held"`.
 */
export function FundsHeldCard({ job }: { job: Job }) {
  const payment = job.payment;
  if (!payment) return null;

  const amount = payment.authorized ?? job.amount;

  return (
    <Card data-testid="funds-held" className="border-emerald-200 bg-emerald-50/40">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Lock aria-hidden="true" className="size-5 text-emerald-700" />
          <CardTitle>Funds held by PayPal</CardTitle>
          <Badge variant="outline" className="border-emerald-300 bg-emerald-100 text-emerald-900">
            {formatMoney(amount)} held
          </Badge>
          {MOCK_MODE ? (
            <Badge variant="secondary" className="bg-amber-100 text-amber-900">
              Mock mode
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-muted-foreground">Authorization</p>
          <p className="font-mono text-xs break-all">{payment.authorizationId ?? 'pending'}</p>
          {payment.orderId ? (
            <p className="mt-1 text-xs text-muted-foreground">
              PayPal order <span className="font-mono">{payment.orderId}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5">
            <Clock aria-hidden="true" className="size-3.5 text-muted-foreground" />
            Hold valid until{' '}
            <span className="font-medium">{formatDate(payment.expiresAt ?? undefined)}</span>
          </p>
          <p className="flex items-center gap-1.5">
            <Clock aria-hidden="true" className="size-3.5 text-muted-foreground" />
            Capture recommended before{' '}
            <span className="font-medium">
              {formatDate(payment.honorPeriodEndsAt ?? undefined)}
            </span>
            {payment.honorPeriodEndsAt ? (
              <span className="text-xs text-muted-foreground">
                ({formatRelativeTime(payment.honorPeriodEndsAt)})
              </span>
            ) : null}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
