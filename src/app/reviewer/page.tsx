import type { Metadata } from 'next';
import Link from 'next/link';

import { ReviewerQueue } from '@/components/review/ReviewerQueue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Reviewer queue',
};

export default function ReviewerPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Reviewer console</h1>
          <p className="mt-1 text-muted-foreground">
            Approve, part-pay or reject escalated jobs — and generate an evidence pack for the record.
          </p>
        </div>
        <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-800">
          Human in the loop
        </Badge>
        <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-800">
          PayPal Sandbox
        </Badge>
        <div className="ml-auto">
          <Button asChild variant="outline" size="sm">
            <Link href="/?as=reviewer">Reviewer role active</Link>
          </Button>
        </div>
      </div>

      <ReviewerQueue />
    </div>
  );
}
