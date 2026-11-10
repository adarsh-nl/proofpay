/**
 * Structural subset of the shared `Money` contract ({ currency, value }).
 * Kept local so this formatter has no dependency on the frozen contracts file.
 */
export interface MoneyLike {
  currency: string;
  value: string;
}

/**
 * Format a `Money` value for display. Money crosses the API as a decimal string
 * of major units ("120.00"); here we only convert it for formatting, never for
 * arithmetic. Returns an em dash for missing or malformed values so the UI never
 * shows "NaN".
 */
export function formatMoney(money: MoneyLike | null | undefined): string {
  if (!money) return '—';
  const { currency, value } = money;
  const cents = decimalStringToCents(value);
  if (cents === null || !currency) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${value} ${currency}`;
  }
}

/** Parse "120.00" / "120" / "0.05" into integer cents without float maths. */
export function decimalStringToCents(value: string): number | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const whole = Number.parseInt(match[2], 10);
  const fraction = Number.parseInt((match[3] ?? '0').padEnd(2, '0'), 10);
  if (!Number.isFinite(whole) || !Number.isFinite(fraction)) return null;
  return sign * (whole * 100 + fraction);
}

/** Integer cents -> "12.34" for request bodies (`Money.value`). */
export function centsToDecimalString(cents: number): string {
  const safe = Math.round(cents);
  const sign = safe < 0 ? '-' : '';
  const absolute = Math.abs(safe);
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  return `${sign}${whole}.${String(fraction).padStart(2, '0')}`;
}

/** ISO timestamp -> local date and time, e.g. "Nov 10, 2026, 9:20 AM". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/** ISO timestamp -> short date only. */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date);
}

/** "just now" / "3 min ago" / "2 h ago" / short date. */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return formatShortDate(iso);
}

/** 0.8 -> "80%". */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 100)}%`;
}

/** Truncate long PayPal ids for compact display, e.g. "MOCK-A…H-1". */
export function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  if (id.length <= 14) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}
