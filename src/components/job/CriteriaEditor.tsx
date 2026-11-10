'use client';

import { Lock } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, ApiClientError } from '@/lib/api-client';
import { formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Criterion, Job } from '@/shared/contracts';

export interface CriteriaEditorProps {
  job: Job;
  onUpdated?: (job: Job) => void;
}

function sumWeight(criteria: Criterion[]): number {
  return criteria.reduce((total, criterion) => total + criterion.weight, 0);
}

/** Editable acceptance criteria for a CREATED job (MANUAL §8 #4). */
export function CriteriaEditor({ job, onUpdated }: CriteriaEditorProps) {
  const [criteria, setCriteria] = useState<Criterion[]>(job.criteria);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editable = criteria.filter((criterion) => criterion.source !== 'system');
  const total = sumWeight(editable);

  function updateCriterion(id: string, patch: Partial<Criterion>) {
    setCriteria((current) =>
      current.map((criterion) => (criterion.id === id ? { ...criterion, ...patch } : criterion)),
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateCriteria(job.id, { criteria });
      toast.success('Acceptance criteria saved');
      onUpdated?.(updated);
      setCriteria(updated.criteria);
    } catch (cause) {
      const message =
        cause instanceof ApiClientError ? cause.message : 'Could not save the criteria.';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Acceptance criteria</CardTitle>
        <CardDescription>
          AI will check each of these from the before/after photos. Edit anything that is not
          photo-checkable. Weights can be re-normalised by the server.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-3">
          {criteria.map((criterion) => {
            const testId = `criteria-row-${criterion.id}`;
            if (criterion.source === 'system') {
              return (
                <li
                  key={criterion.id}
                  data-testid={testId}
                  className="rounded-lg border border-dashed bg-muted/40 p-3"
                >
                  <div className="flex items-start gap-2">
                    <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{criterion.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Locked: the liveness code is added by ProofPay after PayPal authorizes the
                        payment and cannot be removed.
                      </p>
                    </div>
                  </div>
                </li>
              );
            }
            return (
              <li
                key={criterion.id}
                data-testid={testId}
                className="rounded-lg border bg-card p-3 shadow-xs"
              >
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    <span>Check {criterion.id.toUpperCase()}</span>
                    <Input
                      value={criterion.label}
                      onChange={(event) => updateCriterion(criterion.id, { label: event.target.value })}
                      aria-label={`Criterion ${criterion.id} label`}
                    />
                  </label>

                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input accent-primary"
                        checked={criterion.required}
                        onChange={(event) =>
                          updateCriterion(criterion.id, { required: event.target.checked })
                        }
                      />
                      Required
                    </label>

                    <label className="flex flex-1 items-center gap-2 text-sm">
                      <span className="whitespace-nowrap">Weight</span>
                      <input
                        type="range"
                        className="h-2 w-full min-w-24 max-w-48 accent-primary"
                        min={0}
                        max={1}
                        step={0.05}
                        value={criterion.weight}
                        onChange={(event) =>
                          updateCriterion(criterion.id, { weight: Number(event.target.value) })
                        }
                        aria-label={`Weight for criterion ${criterion.id}`}
                      />
                      <span className="w-12 tabular-nums">{formatPercent(criterion.weight)}</span>
                    </label>
                  </div>

                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      How AI verifies this
                    </summary>
                    <textarea
                      className={cn(
                        'mt-2 min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs',
                        'placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                      )}
                      value={criterion.howToVerify}
                      onChange={(event) =>
                        updateCriterion(criterion.id, { howToVerify: event.target.value })
                      }
                      aria-label={`How to verify criterion ${criterion.id}`}
                    />
                  </details>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Weights: <span className="font-medium text-foreground">{formatPercent(total)}</span> of
            100% (the locked liveness criterion has weight 0)
          </p>
          <Button onClick={save} disabled={saving} data-testid="save-criteria">
            {saving ? 'Saving…' : 'Save criteria'}
          </Button>
        </div>

        {error ? (
          <p role="alert" data-testid="toast-error" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
