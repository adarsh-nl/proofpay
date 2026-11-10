import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getJob, listEvents } from "@/server/db/repo";
import { IllegalTransition, transition } from "@/server/escrow/machine";
import { NotFoundError } from "@/server/http/errors";
import { ESCROW_STATUSES, TRANSITIONS, type EscrowStatus } from "@/shared/escrow";
import { makeJob, setupTestApp, teardownTestApp } from "../../helpers";

beforeEach(() => {
  setupTestApp();
});
afterEach(() => teardownTestApp());

/** Walk a job to `target` along allowed transitions. */
const PATHS: Record<EscrowStatus, EscrowStatus[]> = {
  CREATED: [],
  CANCELLED: ["CANCELLED"],
  AUTHORIZED: ["AUTHORIZED"],
  VOIDED: ["AUTHORIZED", "VOIDED"],
  EVIDENCE_SUBMITTED: ["AUTHORIZED", "EVIDENCE_SUBMITTED"],
  VERIFYING: ["AUTHORIZED", "EVIDENCE_SUBMITTED", "VERIFYING"],
  APPROVED: ["AUTHORIZED", "EVIDENCE_SUBMITTED", "VERIFYING", "APPROVED"],
  PARTIAL: ["AUTHORIZED", "EVIDENCE_SUBMITTED", "VERIFYING", "PARTIAL"],
  REJECTED: ["AUTHORIZED", "EVIDENCE_SUBMITTED", "VERIFYING", "REJECTED"],
  HUMAN_REVIEW: ["AUTHORIZED", "EVIDENCE_SUBMITTED", "VERIFYING", "HUMAN_REVIEW"],
  CAPTURED: ["AUTHORIZED", "EVIDENCE_SUBMITTED", "VERIFYING", "APPROVED", "CAPTURED"],
  REFUNDED: ["AUTHORIZED", "EVIDENCE_SUBMITTED", "VERIFYING", "APPROVED", "CAPTURED", "REFUNDED"],
};

function jobIn(status: EscrowStatus): string {
  const job = makeJob();
  for (const step of PATHS[status]) transition(job.id, step, "system");
  return job.id;
}

describe("transition", () => {
  const allowed = ESCROW_STATUSES.flatMap((from) => TRANSITIONS[from].map((to) => [from, to] as const));
  it.each(allowed)("allows %s → %s and records a STATUS_CHANGED event", (from, to) => {
    const id = jobIn(from);
    const before = listEvents(id).length;
    const job = transition(id, to, "reviewer", { note: "x" });
    expect(job.status).toBe(to);
    const events = listEvents(id);
    expect(events).toHaveLength(before + 1);
    expect(events.at(-1)).toMatchObject({
      type: "STATUS_CHANGED",
      fromStatus: from,
      toStatus: to,
      actor: "reviewer",
      data: { note: "x" },
    });
  });

  const illegal = ESCROW_STATUSES.flatMap((from) =>
    ESCROW_STATUSES.filter((to) => !TRANSITIONS[from].includes(to)).map((to) => [from, to] as const),
  );
  it.each(illegal)("rejects %s → %s and changes nothing", (from, to) => {
    const id = jobIn(from);
    const before = listEvents(id).length;
    expect(() => transition(id, to, "system")).toThrow(IllegalTransition);
    expect(getJob(id)?.status).toBe(from);
    expect(listEvents(id)).toHaveLength(before);
  });

  it("carries from and to on IllegalTransition", () => {
    const id = jobIn("CREATED");
    try {
      transition(id, "CAPTURED", "system");
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ from: "CREATED", to: "CAPTURED" });
    }
  });

  it("throws NotFoundError for an unknown job", () => {
    expect(() => transition("nope", "AUTHORIZED", "system")).toThrow(NotFoundError);
  });
});
