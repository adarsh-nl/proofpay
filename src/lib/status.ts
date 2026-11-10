/**
 * Status and verdict presentation helpers. Colour is never the only signal: every
 * chip also carries a text label (AGENTS.md §8 accessibility rule).
 */

import type { CriterionVerdict, DecisionOutcome, EscrowStatus, ForensicsLevel } from '@/shared/contracts';

export const STATUS_LABELS: Record<EscrowStatus, string> = {
  CREATED: 'Created',
  AUTHORIZED: 'Funds held',
  EVIDENCE_SUBMITTED: 'Evidence submitted',
  VERIFYING: 'AI verifying',
  APPROVED: 'Approved',
  PARTIAL: 'Partial proposal',
  REJECTED: 'Rejected',
  HUMAN_REVIEW: 'Human review',
  CAPTURED: 'Captured',
  VOIDED: 'Voided',
  REFUNDED: 'Refunded',
  CANCELLED: 'Cancelled',
};

/** PASS/CAPTURED green, PARTIAL amber, FAIL/REJECTED red, UNCERTAIN/HUMAN_REVIEW blue, VOIDED grey. */
export const STATUS_BADGE_CLASS: Record<EscrowStatus, string> = {
  CREATED: 'border-zinc-300 bg-zinc-100 text-zinc-800',
  AUTHORIZED: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  EVIDENCE_SUBMITTED: 'border-blue-300 bg-blue-50 text-blue-800',
  VERIFYING: 'border-blue-300 bg-blue-50 text-blue-800',
  APPROVED: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  PARTIAL: 'border-amber-300 bg-amber-50 text-amber-900',
  REJECTED: 'border-red-300 bg-red-50 text-red-800',
  HUMAN_REVIEW: 'border-blue-300 bg-blue-50 text-blue-800',
  CAPTURED: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  VOIDED: 'border-zinc-300 bg-zinc-100 text-zinc-700',
  REFUNDED: 'border-zinc-300 bg-zinc-100 text-zinc-700',
  CANCELLED: 'border-zinc-300 bg-zinc-100 text-zinc-700',
};

export function statusLabel(status: EscrowStatus | string): string {
  return STATUS_LABELS[status as EscrowStatus] ?? status;
}

export function statusClass(status: EscrowStatus | string): string {
  return STATUS_BADGE_CLASS[status as EscrowStatus] ?? 'border-zinc-300 bg-zinc-100 text-zinc-800';
}

export const VERDICT_BADGE_CLASS: Record<CriterionVerdict['verdict'], string> = {
  PASS: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  FAIL: 'border-red-300 bg-red-50 text-red-800',
  UNCERTAIN: 'border-blue-300 bg-blue-50 text-blue-800',
  NOT_VISIBLE: 'border-zinc-300 bg-zinc-100 text-zinc-700',
};

export const VERDICT_LABELS: Record<CriterionVerdict['verdict'], string> = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNCERTAIN: 'UNCERTAIN',
  NOT_VISIBLE: 'NOT VISIBLE',
};

export const OUTCOME_BADGE_CLASS: Record<DecisionOutcome, string> = {
  APPROVED: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  PARTIAL: 'border-amber-300 bg-amber-50 text-amber-900',
  REJECTED: 'border-red-300 bg-red-50 text-red-800',
  HUMAN_REVIEW: 'border-blue-300 bg-blue-50 text-blue-800',
};

export const OUTCOME_LABELS: Record<DecisionOutcome, string> = {
  APPROVED: 'Approved — full capture',
  PARTIAL: 'Partial — proposal for review',
  REJECTED: 'Rejected',
  HUMAN_REVIEW: 'Escalated to human review',
};

export const FLAG_LEVEL_CLASS: Record<ForensicsLevel, string> = {
  HIGH: 'border-red-300 bg-red-50 text-red-800',
  MEDIUM: 'border-amber-300 bg-amber-50 text-amber-900',
  INFO: 'border-zinc-300 bg-zinc-100 text-zinc-700',
};

export const FLAG_LEVEL_LABELS: Record<ForensicsLevel, string> = {
  HIGH: 'High risk',
  MEDIUM: 'Medium risk',
  INFO: 'Info',
};

export const CATEGORY_LABELS: Record<string, string> = {
  bike_repair: 'Bike repair',
  cleaning: 'Cleaning',
  assembly: 'Assembly',
  delivery: 'Delivery',
  other: 'Other',
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}
