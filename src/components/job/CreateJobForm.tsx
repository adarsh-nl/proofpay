'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, ApiClientError } from '@/lib/api-client';
import { CATEGORIES } from '@/lib/constants';
import type { JobCategory } from '@/shared/contracts';
import { CreateJobBodySchema } from '@/shared/contracts';

interface FormValues {
  title: string;
  description: string;
  category: JobCategory;
  amount: string;
}

const INITIAL_VALUES: FormValues = {
  title: '',
  description: '',
  category: 'bike_repair',
  amount: '',
};

export function CreateJobForm() {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function setField<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    const payload = {
      title: values.title.trim(),
      description: values.description.trim(),
      category: values.category,
      amount: { currency: 'USD', value: values.amount.trim() },
    };
    const parsed = CreateJobBodySchema.safeParse(payload);
    if (!parsed.success) {
      const errors: Partial<Record<keyof FormValues, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'title' || field === 'description' || field === 'category') {
          errors[field] = issue.message;
        } else if (field === 'amount') {
          errors.amount = 'Enter an amount greater than zero, e.g. 60.00';
        }
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setPending(true);
    try {
      const job = await api.createJob(parsed.data);
      toast.success('Job created — AI drafted the acceptance criteria');
      router.push(`/jobs/${job.id}`);
    } catch (cause) {
      const message =
        cause instanceof ApiClientError ? cause.message : 'Could not create the job. Try again.';
      setSubmitError(message);
      toast.error(message);
      setPending(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
              <span>Job title</span>
              <Input
                data-testid="create-job-title"
                value={values.title}
                onChange={(event) => setField('title', event.target.value)}
                placeholder="Replace bike chain"
                maxLength={120}
                required
                aria-invalid={Boolean(fieldErrors.title)}
                aria-describedby={fieldErrors.title ? 'create-job-title-error' : undefined}
              />
              {fieldErrors.title ? (
                <span id="create-job-title-error" className="text-xs text-destructive">
                  {fieldErrors.title}
                </span>
              ) : null}
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
              <span>What needs to be done?</span>
              <textarea
                data-testid="create-job-description"
                className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                value={values.description}
                onChange={(event) => setField('description', event.target.value)}
                placeholder="The chain on my commuter bike is worn out. Replace it and check the tension."
                maxLength={2000}
                required
                aria-invalid={Boolean(fieldErrors.description)}
                aria-describedby={fieldErrors.description ? 'create-job-description-error' : undefined}
              />
              {fieldErrors.description ? (
                <span id="create-job-description-error" className="text-xs text-destructive">
                  {fieldErrors.description}
                </span>
              ) : null}
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              <span>Category</span>
              <select
                data-testid="create-job-category"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                value={values.category}
                onChange={(event) => setField('category', event.target.value as JobCategory)}
                aria-invalid={Boolean(fieldErrors.category)}
              >
                {CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              <span>Amount (USD)</span>
              <Input
                data-testid="create-job-amount"
                value={values.amount}
                onChange={(event) => setField('amount', event.target.value)}
                placeholder="60.00"
                inputMode="decimal"
                required
                aria-invalid={Boolean(fieldErrors.amount)}
                aria-describedby={fieldErrors.amount ? 'create-job-amount-error' : undefined}
              />
              {fieldErrors.amount ? (
                <span id="create-job-amount-error" className="text-xs text-destructive">
                  {fieldErrors.amount}
                </span>
              ) : null}
            </label>
          </div>

          <p className="text-sm text-muted-foreground">
            On submit, AI drafts 3–6 photo-checkable acceptance criteria. You can edit them on the
            next screen before you hold the money with PayPal.
          </p>

          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Nothing is charged yet: the next step authorizes (holds) the payment with PayPal.
            </p>
            <Button type="submit" disabled={pending} data-testid="create-job-submit">
              {pending ? 'Creating job…' : 'Create job'}
            </Button>
          </div>

          {submitError ? (
            <p role="alert" data-testid="toast-error" className="text-sm text-destructive">
              {submitError}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
