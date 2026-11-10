/**
 * Bounding-box maths for the verification viewer.
 *
 * The VLM returns boxes as `[ymin, xmin, ymax, xmax]` normalised to 0..1000
 * (MANUAL §9.2). The viewer positions them with percentage CSS so they scale when
 * the image is resized:
 *   top = ymin/10 %, left = xmin/10 %,
 *   height = (ymax-ymin)/10 %, width = (xmax-xmin)/10 %
 */

export type NormalizedBox = readonly [number, number, number, number];

export interface BoxRect {
  top: number;
  left: number;
  height: number;
  width: number;
}

const NORMALISED_MAX = 1000;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampNormalised(value: number): number {
  return clamp(value, 0, NORMALISED_MAX);
}

/**
 * Convert a normalised `[ymin, xmin, ymax, xmax]` box into percentages of the
 * rendered image box. Inverted corners are sorted and out-of-range values clamped,
 * so a malformed box never escapes the image.
 */
export function boxToPercent(box: NormalizedBox): BoxRect {
  const [rawYmin, rawXmin, rawYmax, rawXmax] = box;
  const ymin = clampNormalised(Math.min(rawYmin, rawYmax));
  const ymax = clampNormalised(Math.max(rawYmin, rawYmax));
  const xmin = clampNormalised(Math.min(rawXmin, rawXmax));
  const xmax = clampNormalised(Math.max(rawXmin, rawXmax));

  return {
    top: (ymin / NORMALISED_MAX) * 100,
    left: (xmin / NORMALISED_MAX) * 100,
    height: ((ymax - ymin) / NORMALISED_MAX) * 100,
    width: ((xmax - xmin) / NORMALISED_MAX) * 100,
  };
}

/** `boxToPercent` result as a React inline style. */
export function boxToStyle(box: NormalizedBox): {
  top: string;
  left: string;
  height: string;
  width: string;
} {
  const rect = boxToPercent(box);
  const round = (value: number) => `${Math.round(value * 1000) / 1000}%`;
  return {
    top: round(rect.top),
    left: round(rect.left),
    height: round(rect.height),
    width: round(rect.width),
  };
}

/**
 * The VLM labels evidence images `A1..An` (after) and `B1..Bn` (before); the
 * upload pipeline stores them as `<phase>_<n>.jpg` in the job folder (T09).
 */
export function evidenceImageUrl(jobId: string, imageId: string): string {
  const match = /^([AB])(\d+)$/i.exec(imageId.trim());
  if (!match) {
    return `/api/uploads/${encodeURIComponent(jobId)}/${encodeURIComponent(imageId)}`;
  }
  const phase = match[1].toUpperCase() === 'A' ? 'after' : 'before';
  const index = Math.max(1, Number.parseInt(match[2], 10));
  return `/api/uploads/${encodeURIComponent(jobId)}/${phase}_${index}.jpg`;
}

/** Human label for an image id, e.g. "A2" -> "After photo 2". */
export function evidenceImageLabel(imageId: string): string {
  const match = /^([AB])(\d+)$/i.exec(imageId.trim());
  if (!match) return imageId;
  const phase = match[1].toUpperCase() === 'A' ? 'After' : 'Before';
  return `${phase} photo ${match[2]}`;
}
