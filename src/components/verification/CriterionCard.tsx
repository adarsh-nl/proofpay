'use client';

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { VERDICT_BADGE_CLASS, VERDICT_LABELS } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { Criterion, CriterionVerdict } from '@/shared/contracts';

export interface CriterionCardProps {
  criterion?: Criterion;
  verdict: CriterionVerdict;
  active: boolean;
  onHoverChange: (criterionId: string | null) => void;
}

/**
 * One acceptance criterion with its AI verdict chip (`verdict-<criterionId>`),
 * confidence bar and rationale. Hover/focus drives the box highlight in the viewer.
 */
export function CriterionCard({ criterion, verdict, active, onHoverChange }: CriterionCardProps) {
  const confidencePercent = Math.round(verdict.confidence * 100);
  const label = criterion?.label ?? verdict.criterionId;

  return (
    <div
      className={cn(
        'flex h-full flex-col gap-3 rounded-lg border bg-card p-4 shadow-xs transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        active ? 'border-emerald-300 bg-emerald-50/40' : '',
      )}
      tabIndex={0}
      role="group"
      aria-label={`Criterion ${verdict.criterionId}: ${label}`}
      onMouseEnter={() => onHoverChange(verdict.criterionId)}
      onMouseLeave={() => onHoverChange(null)}
      onFocus={() => onHoverChange(verdict.criterionId)}
      onBlur={() => onHoverChange(null)}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">
          <span className="mr-1 text-xs text-muted-foreground uppercase">
            {verdict.criterionId === 'cL' ? 'Liveness' : verdict.criterionId}
          </span>
          {label}
        </p>
        <Badge
          variant="outline"
          data-testid={`verdict-${verdict.criterionId}`}
          className={cn('shrink-0', VERDICT_BADGE_CLASS[verdict.verdict])}
          aria-label={`Verdict ${verdict.verdict}`}
        >
          {VERDICT_LABELS[verdict.verdict]}
        </Badge>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>Confidence</span>
          <span className="tabular-nums">{confidencePercent}%</span>
        </div>
        <Progress value={confidencePercent} aria-label={`Confidence ${confidencePercent} percent`} />
      </div>

      <p className="text-sm text-muted-foreground">{verdict.rationale}</p>
    </div>
  );
}
