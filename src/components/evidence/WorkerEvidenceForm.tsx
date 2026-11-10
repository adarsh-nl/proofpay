'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import type { EvidenceItem, EvidencePhase, Job } from '@/shared/contracts';

import { EvidenceDropzone, type LocalPhoto } from './EvidenceDropzone';
import { LivenessBanner } from './LivenessBanner';

type Shot = LocalPhoto & { phase: EvidencePhase };

function errorText(cause: unknown): string {
  if (cause instanceof ApiClientError) return cause.message;
  if (cause instanceof Error) return cause.message;
  return 'Something went wrong while saving the photos.';
}

function shotsFromEvidence(items: EvidenceItem[]): Shot[] {
  return items.map((item) => ({
    id: item.id,
    name: item.phase === 'before' ? 'Before photo' : 'After photo',
    previewUrl: item.url,
    phase: item.phase,
  }));
}

export function WorkerEvidenceForm({
  job,
  initialEvidence = [],
}: {
  job: Job;
  initialEvidence?: EvidenceItem[];
}) {
  const router = useRouter();
  const [shots, setShots] = useState<Shot[]>(() => shotsFromEvidence(initialEvidence));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const afterCount = useMemo(() => shots.filter((shot) => shot.phase === 'after').length, [shots]);
  // Submit stays disabled until at least one after photo is attached (endpoint 9).
  const submitDisabled = busy || afterCount < 1;

  function fail(cause: unknown) {
    const message = errorText(cause);
    setError(message);
    toast.error(message);
  }

  async function add(phase: EvidencePhase, files: File[]) {
    setBusy(true);
    setError(null);
    const previews = files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    try {
      const saved = await api.uploadEvidence(job.id, phase, files);
      setShots((current) => [
        ...current,
        ...saved.map((item, index) => ({
          id: item.id,
          name: previews[index]?.file.name ?? item.id,
          previewUrl: item.url || previews[index]?.previewUrl || '',
          phase,
        })),
      ]);
      previews.forEach((preview, index) => {
        if (saved[index]?.url) URL.revokeObjectURL(preview.previewUrl);
      });
    } catch (cause) {
      previews.forEach((preview) => URL.revokeObjectURL(preview.previewUrl));
      fail(cause);
    } finally {
      setBusy(false);
    }
  }

  async function remove(photo: LocalPhoto) {
    setBusy(true);
    setError(null);
    try {
      await api.deleteEvidence(job.id, photo.id);
      setShots((current) => current.filter((shot) => shot.id !== photo.id));
      if (photo.previewUrl.startsWith('blob:')) URL.revokeObjectURL(photo.previewUrl);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (submitDisabled) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitEvidence(job.id);
      router.push(`/jobs/${encodeURIComponent(job.id)}`);
    } catch (cause) {
      fail(cause);
      setBusy(false);
    }
  }

  const code = job.livenessCode;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">Worker evidence</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{job.title}</h1>
        <p className="text-sm text-muted-foreground">
          Held by PayPal · {formatMoney(job.amount)} · Verified by AI after you submit
        </p>
      </header>

      <LivenessBanner code={code} />

      <section aria-labelledby="what-to-photograph" className="flex flex-col gap-2">
        <h2 id="what-to-photograph" className="text-lg font-semibold">
          What to photograph
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          {job.criteria.map((criterion) => (
            <li key={criterion.id}>
              {code ? criterion.label.replaceAll('{CODE}', code) : criterion.label}
              {criterion.required ? ' (required)' : ''}
            </li>
          ))}
        </ul>
      </section>

      <EvidenceDropzone
        phase="before"
        photos={shots.filter((shot) => shot.phase === 'before')}
        disabled={busy}
        onAdd={(files) => add('before', files)}
        onRemove={(photo) => remove(photo)}
      />
      <EvidenceDropzone
        phase="after"
        photos={shots.filter((shot) => shot.phase === 'after')}
        disabled={busy}
        onAdd={(files) => add('after', files)}
        onRemove={(photo) => remove(photo)}
      />

      {error ? (
        <p role="alert" data-testid="toast-error" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="lg"
          data-testid="submit-evidence"
          disabled={submitDisabled}
          onClick={() => void submit()}
        >
          {busy ? 'Saving…' : 'Submit evidence'}
        </Button>
        <p className="text-sm text-muted-foreground">
          {afterCount < 1
            ? 'Add at least one after photo to submit.'
            : 'Submit sends the photos for AI verification. The customer page updates when it finishes.'}
        </p>
      </div>
    </div>
  );
}
