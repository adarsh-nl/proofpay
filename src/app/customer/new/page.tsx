import type { Metadata } from 'next';
import Link from 'next/link';

import { CreateJobForm } from '@/components/job/CreateJobForm';

export const metadata: Metadata = {
  title: 'Create a job',
};

export default function NewJobPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Create a job</h1>
        <p className="mt-2 text-muted-foreground">
          Describe the work and the budget. AI turns it into photo-checkable acceptance criteria, and
          PayPal holds the money until the proof is in.
        </p>
      </div>

      <CreateJobForm />

      <p className="mt-6 text-sm text-muted-foreground">
        Already have a job id?{' '}
        <Link className="underline" href="/?as=customer">
          Open the job from the customer view
        </Link>
        .
      </p>
    </div>
  );
}
