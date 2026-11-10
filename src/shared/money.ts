/**
 * Money helpers — integer minor units ("cents") internally, decimal strings at
 * the PayPal/API boundary (docs/AGENTS.md §8: never do float money maths).
 * Isomorphic: no node imports.
 */

const MONEY_RE = /^(\d{1,12})(?:\.(\d{1,2}))?$/;

/**
 * Parse a decimal amount string into integer minor units.
 * `toCents("12.34") === 1234`, `toCents("0.1") === 10`, `toCents("5") === 500`.
 */
export function toCents(value: string): number {
  const match = MONEY_RE.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid money value: ${JSON.stringify(value)}`);
  }
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0") || "0");
  return whole * 100 + fraction;
}

/**
 * Format integer minor units as a decimal amount string.
 * `fromCents(1234) === "12.34"`, `fromCents(0) === "0.00"`.
 */
export function fromCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`Money must be integer minor units, got ${cents}`);
  }
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  return `${negative ? "-" : ""}${whole}.${String(fraction).padStart(2, "0")}`;
}

/**
 * `floorToStep(totalCents, ratio, step)` = amount scaled by `ratio`, floored
 * down to a multiple of `step` (partial-capture rounding, MANUAL §9.4).
 *
 * All maths is done in integer thousandths so float noise cannot lose a step:
 * a score of `0.8000000000000002` must still give 80% of 12000 = 9600 cents,
 * and ratio 0.849 with step 0.05 gives 0.80 (never floor a raw float).
 */
export function floorToStep(
  totalCents: number,
  ratio: number,
  step: number,
): number {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error(`totalCents must be a non-negative integer, got ${totalCents}`);
  }
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error(`ratio must be within [0, 1], got ${ratio}`);
  }
  if (!Number.isFinite(step) || step <= 0 || step > 1) {
    throw new Error(`step must be within (0, 1], got ${step}`);
  }
  const ratioThousandths = Math.round(ratio * 1000);
  const stepThousandths = Math.round(step * 1000);
  const steps = Math.floor(ratioThousandths / stepThousandths);
  const flooredThousandths = steps * stepThousandths;
  return Math.floor((totalCents * flooredThousandths) / 1000);
}
