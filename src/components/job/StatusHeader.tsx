import { Badge } from '@/components/ui/badge';
import { formatDate, formatMoney } from '@/lib/format';
import { CATEGORY_LABELS, statusClass, statusLabel } from '@/lib/status';
import type { Job } from '@/shared/contracts';

/** Job header: title, description, amount and the escrow status chip (`job-status`). */
export function StatusHeader({ job }: { job: Job }) {
  return (
    <div className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{job.title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{job.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge
            data-testid="job-status"
            data-status={job.status}
            variant="outline"
            className={statusClass(job.status)}
          >
            {statusLabel(job.status)}
          </Badge>
          <Badge variant="outline">{formatMoney(job.amount)}</Badge>
          <Badge variant="outline">{CATEGORY_LABELS[job.category] ?? job.category}</Badge>
          {job.livenessCode ? (
            <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-800">
              Liveness code {job.livenessCode}
            </Badge>
          ) : null}
        </div>
      </div>
      <dl className="shrink-0 text-xs text-muted-foreground sm:text-right">
        <dt className="sr-only">Created</dt>
        <dd>Created {formatDate(job.createdAt)}</dd>
        <dt className="sr-only">Updated</dt>
        <dd>Updated {formatDate(job.updatedAt)}</dd>
      </dl>
    </div>
  );
}
