import { Badge } from '@/components/ui/badge';
import { formatMoney, formatPercent } from '@/lib/format';
import { OUTCOME_BADGE_CLASS, OUTCOME_LABELS } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { VerificationBundle } from '@/shared/contracts';

/**
 * Headline result of a verification run: outcome, score, model attribution and
 * the same-scene / liveness details.
 */
export function VerificationSummary({ verification }: { verification: VerificationBundle }) {
  const { report, decision } = verification;
  const readCode = report.livenessCode.readValue;

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          data-testid="verification-outcome"
          data-outcome={decision.outcome}
          className={cn('text-sm', OUTCOME_BADGE_CLASS[decision.outcome])}
        >
          {OUTCOME_LABELS[decision.outcome]}
        </Badge>
        <Badge variant="secondary">Score {formatPercent(decision.score)}</Badge>
        {decision.captureAmount ? (
          <Badge variant="outline">Capture {formatMoney(decision.captureAmount)}</Badge>
        ) : null}
        <Badge variant="outline">
          Verified by AI ({verification.model}){verification.mock ? ' · mock' : ''}
        </Badge>
        <Badge variant="outline">
          Same scene: {report.sameScene.verdict} ({formatPercent(report.sameScene.confidence)})
        </Badge>
        {readCode ? (
          <Badge variant="outline">
            Liveness code read: <span className="ml-1 font-mono">{readCode}</span>
          </Badge>
        ) : (
          <Badge variant="outline">Liveness code not read</Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{report.summary}</p>
    </div>
  );
}
