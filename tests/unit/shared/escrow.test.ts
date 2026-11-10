import { describe, expect, it } from "vitest";
import {
  ESCROW_STATUSES,
  TERMINAL,
  TRANSITIONS,
  canTransition,
  isTerminal,
  type EscrowStatus,
} from "@/shared/escrow";

const ALLOWED: Array<[EscrowStatus, EscrowStatus]> = [
  ["CREATED", "AUTHORIZED"],
  ["CREATED", "CANCELLED"],
  ["AUTHORIZED", "EVIDENCE_SUBMITTED"],
  ["AUTHORIZED", "VOIDED"],
  ["EVIDENCE_SUBMITTED", "VERIFYING"],
  ["VERIFYING", "APPROVED"],
  ["VERIFYING", "PARTIAL"],
  ["VERIFYING", "REJECTED"],
  ["VERIFYING", "HUMAN_REVIEW"],
  ["APPROVED", "CAPTURED"],
  ["PARTIAL", "CAPTURED"],
  ["PARTIAL", "HUMAN_REVIEW"],
  ["REJECTED", "EVIDENCE_SUBMITTED"],
  ["REJECTED", "VOIDED"],
  ["HUMAN_REVIEW", "APPROVED"],
  ["HUMAN_REVIEW", "PARTIAL"],
  ["HUMAN_REVIEW", "REJECTED"],
  ["CAPTURED", "REFUNDED"],
];

const ILLEGAL: Array<[EscrowStatus, EscrowStatus]> = [
  ["CREATED", "CAPTURED"],
  ["VOIDED", "AUTHORIZED"],
  ["CAPTURED", "VOIDED"],
];

describe("escrow transition table", () => {
  it("exposes all 12 statuses in MANUAL §7 order", () => {
    expect(ESCROW_STATUSES).toHaveLength(12);
    expect(ESCROW_STATUSES[0]).toBe("CREATED");
    expect(ESCROW_STATUSES).toContain("HUMAN_REVIEW");
  });

  it.each(ALLOWED)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(TRANSITIONS[from]).toContain(to);
  });

  it.each(ILLEGAL)("rejects %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("matches the table exhaustively for every pair", () => {
    for (const from of ESCROW_STATUSES) {
      for (const to of ESCROW_STATUSES) {
        expect(canTransition(from, to)).toBe(TRANSITIONS[from].includes(to));
      }
    }
  });

  it("has no outgoing transitions from terminal statuses (CAPTURED may only be refunded)", () => {
    for (const status of TERMINAL) {
      if (status === "CAPTURED") {
        expect(TRANSITIONS[status]).toEqual(["REFUNDED"]);
        continue;
      }
      expect(TRANSITIONS[status]).toEqual([]);
      expect(isTerminal(status)).toBe(true);
    }
    expect(TERMINAL).toEqual(["CAPTURED", "VOIDED", "REFUNDED", "CANCELLED"]);
  });

  it("only knows transitions between known statuses", () => {
    for (const from of ESCROW_STATUSES) {
      for (const to of TRANSITIONS[from]) {
        expect(ESCROW_STATUSES).toContain(to);
      }
    }
  });
});
