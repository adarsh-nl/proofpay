import { Badge } from '@/components/ui/badge';
import { FLAG_LEVEL_CLASS, FLAG_LEVEL_LABELS } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { ForensicsFlag } from '@/shared/contracts';

/**
 * Fraud / forensics signals from the deterministic forensics pass (MANUAL §9.3).
 * HIGH is red, MEDIUM amber, INFO grey; every badge also carries level text.
 */
export function FlagsPanel({ flags }: { flags: ForensicsFlag[] }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Fraud &amp; photo checks</h3>
      {flags.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No fraud signals found: the photos are distinct, recent and from the same scene.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {flags.map((flag, index) => (
            <li
              key={`${flag.code}-${index}`}
              data-testid={`flag-${flag.code}`}
              className={cn('flex flex-col gap-1 rounded-md border p-3 text-sm', FLAG_LEVEL_CLASS[flag.level])}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn('shrink-0 uppercase', FLAG_LEVEL_CLASS[flag.level])}>
                  {FLAG_LEVEL_LABELS[flag.level]}
                </Badge>
                <span className="font-mono text-xs font-semibold">{flag.code}</span>
              </div>
              <p>{flag.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
