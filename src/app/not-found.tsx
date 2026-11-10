import Link from 'next/link';

import { Button } from '@/components/ui/button';

/** Friendly 404 for unknown pages and missing job ids. */
export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">That page does not exist</h1>
      <p className="mt-2 text-muted-foreground">
        The job id may be wrong, or the job was removed. Start from the landing page — the demo jobs
        are listed there.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/">Back to the landing page</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/customer/new">Create a job</Link>
        </Button>
      </div>
    </div>
  );
}
