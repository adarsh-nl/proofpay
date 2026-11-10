/**
 * Escrow state machine — the single source of truth for statuses and allowed
 * transitions (docs/MANUAL.md §7). Isomorphic: no node imports.
 */

export const ESCROW_STATUSES = [
  "CREATED",
  "AUTHORIZED",
  "EVIDENCE_SUBMITTED",
  "VERIFYING",
  "APPROVED",
  "PARTIAL",
  "REJECTED",
  "HUMAN_REVIEW",
  "CAPTURED",
  "VOIDED",
  "REFUNDED",
  "CANCELLED",
] as const;

export type EscrowStatus = (typeof ESCROW_STATUSES)[number];

/** Allowed transitions, copied verbatim from docs/MANUAL.md §7. */
export const TRANSITIONS: Record<EscrowStatus, readonly EscrowStatus[]> = {
  CREATED: ["AUTHORIZED", "CANCELLED"],
  AUTHORIZED: ["EVIDENCE_SUBMITTED", "VOIDED"],
  EVIDENCE_SUBMITTED: ["VERIFYING"],
  VERIFYING: ["APPROVED", "PARTIAL", "REJECTED", "HUMAN_REVIEW"],
  APPROVED: ["CAPTURED"],
  PARTIAL: ["CAPTURED", "HUMAN_REVIEW"],
  REJECTED: ["EVIDENCE_SUBMITTED", "VOIDED"],
  HUMAN_REVIEW: ["APPROVED", "PARTIAL", "REJECTED"],
  CAPTURED: ["REFUNDED"],
  VOIDED: [],
  REFUNDED: [],
  CANCELLED: [],
};

/** Statuses with no outgoing transitions. */
export const TERMINAL: readonly EscrowStatus[] = [
  "CAPTURED",
  "VOIDED",
  "REFUNDED",
  "CANCELLED",
];

export function canTransition(from: EscrowStatus, to: EscrowStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: EscrowStatus): boolean {
  return TERMINAL.includes(status);
}
