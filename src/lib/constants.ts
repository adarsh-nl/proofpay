import type { JobCategory } from '@/shared/contracts';

/** Categories shown in the create-job form (labels mirror the backend seeds). */
export const CATEGORIES: ReadonlyArray<{ value: JobCategory; label: string }> = [
  { value: 'bike_repair', label: 'Bike repair' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'assembly', label: 'Assembly' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'other', label: 'Other' },
];

/** How often the job page polls while verification is running (C2). */
export const POLL_INTERVAL_MS = 2000;

/** Roles that may see the 4-digit liveness code (C9). */
export const LIVENESS_CODE_ROLES = ['worker', 'reviewer'] as const;

/** Sandbox activity page used as a plain-text reference for PayPal ids. */
export const PAYPAL_SANDBOX_ACTIVITY_URL = 'https://www.sandbox.paypal.com/activity';
