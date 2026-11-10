'use client';

import { useState } from 'react';

import { evidenceImageLabel, evidenceImageUrl, boxToStyle } from '@/lib/boxes';
import { cn } from '@/lib/utils';
import type { Box as EvidenceBox, VerificationReport } from '@/shared/contracts';

export const EVIDENCE_PLACEHOLDER = '/evidence-placeholder.svg';

interface EvidenceViewerProps {
  jobId: string;
  report: VerificationReport;
  /** Criterion currently hovered/focused in the criteria list; its boxes are highlighted. */
  activeCriterionId?: string | null;
}

function collectImageIds(report: VerificationReport): string[] {
  const ids = new Set<string>();
  for (const verdict of report.verdicts) {
    for (const box of verdict.evidence) {
      ids.add(box.imageId);
    }
  }
  if (ids.size === 0) ids.add('A1');
  return [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function BoxOverlay({
  box,
  highlight,
  note,
}: {
  box: EvidenceBox;
  highlight: boolean;
  note: string;
}) {
  return (
    <span
      aria-hidden="true"
      title={note}
      className={cn(
        'pointer-events-none absolute rounded-sm border-2 transition-colors',
        highlight
          ? 'border-emerald-400 bg-emerald-400/20 shadow-[0_0_0_2px_rgba(16,185,129,0.35)]'
          : 'border-white/80 bg-white/5',
      )}
      style={boxToStyle(box.box_2d as unknown as readonly [number, number, number, number])}
    />
  );
}

/**
 * Renders the evidence photos with the VLM bounding boxes on top. Boxes scale
 * with the image because they are positioned in percentages of the image wrapper.
 */
export function EvidenceViewer({ jobId, report, activeCriterionId }: EvidenceViewerProps) {
  const imageIds = collectImageIds(report);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const boxesByImage = new Map<string, { box: EvidenceBox; criterionId: string }[]>();
  for (const verdict of report.verdicts) {
    for (const box of verdict.evidence) {
      const list = boxesByImage.get(box.imageId) ?? [];
      list.push({ box, criterionId: verdict.criterionId });
      boxesByImage.set(box.imageId, list);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 sm:grid-cols-2">
        {imageIds.map((imageId) => {
          const boxes = boxesByImage.get(imageId) ?? [];
          const failed = failedImages[imageId];
          return (
            <figure key={imageId} className="flex flex-col gap-2">
              <div className="relative inline-block w-full overflow-hidden rounded-lg border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- evidence is served by our own API route and must scale with its wrapper */}
                <img
                  src={failed ? EVIDENCE_PLACEHOLDER : evidenceImageUrl(jobId, imageId)}
                  alt={`${evidenceImageLabel(imageId)} for this job`}
                  className="block h-auto w-full"
                  loading="lazy"
                  onError={() => setFailedImages((current) => ({ ...current, [imageId]: true }))}
                />
                {!failed
                  ? boxes.map((entry, index) => (
                      <BoxOverlay
                        key={`${entry.criterionId}-${index}`}
                        box={entry.box}
                        highlight={activeCriterionId === entry.criterionId}
                        note={`${entry.criterionId}: ${entry.box.note}`}
                      />
                    ))
                  : null}
                {failed ? (
                  <p className="absolute inset-x-0 bottom-0 bg-background/90 px-2 py-1 text-xs text-muted-foreground">
                    Evidence image not available yet
                  </p>
                ) : null}
              </div>
              <figcaption className="text-xs text-muted-foreground">
                {evidenceImageLabel(imageId)}
                {boxes.length > 0
                  ? ` · ${boxes.length} evidence box${boxes.length === 1 ? '' : 'es'}`
                  : ''}
              </figcaption>
            </figure>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Boxes show the area AI used for a verdict. Hover a criterion below to highlight its boxes.
      </p>
    </div>
  );
}
