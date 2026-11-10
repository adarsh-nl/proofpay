export const ROLE_COOKIE = 'pp_role';

export const ROLES = ['customer', 'worker', 'reviewer'] as const;

export type Role = (typeof ROLES)[number];

export const DEFAULT_ROLE: Role = 'customer';

export const ROLE_LABELS: Record<Role, string> = {
  customer: 'Customer',
  worker: 'Worker',
  reviewer: 'Reviewer',
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Parse a raw cookie / query value into a Role, falling back to customer. */
export function parseRole(value: string | null | undefined): Role {
  return isRole(value) ? value : DEFAULT_ROLE;
}

/** Build the Set-Cookie string for the role cookie (C1: path /, Lax, 7 days). */
export function roleCookie(role: Role): string {
  return `${ROLE_COOKIE}=${role}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`;
}

/** Client-only: write the role cookie. Safe no-op on the server. */
export function setRoleCookie(role: Role): void {
  if (typeof document === 'undefined') return;
  document.cookie = roleCookie(role);
}

/** Client-only: read the role cookie. */
export function getRoleCookie(): Role {
  if (typeof document === 'undefined') return DEFAULT_ROLE;
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ROLE_COOKIE}=`));
  if (!match) return DEFAULT_ROLE;
  return parseRole(decodeURIComponent(match.slice(ROLE_COOKIE.length + 1)));
}
