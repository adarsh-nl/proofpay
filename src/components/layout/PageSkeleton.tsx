import { Skeleton } from '@/components/ui/skeleton';

/** Shared route-level loading state: header + a couple of cards. */
export function PageSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8" aria-busy="true" aria-label="Loading page">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-6 w-24" />
      </div>
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-6 flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
    </div>
  );
}
