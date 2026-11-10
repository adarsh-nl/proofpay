import { beforeEach, describe, expect, it } from "vitest";
import { TRANSITIONS, type EscrowStatus } from "@/shared/escrow";
import {
  createDb,
  runMigrations,
  type ProofPayDb,
} from "@/server/db/client";
import { createJob, getJob } from "@/server/db/repo";
import {
  IllegalTransition,
  transition,
} from "@/server/escrow/machine";
import { NotFoundError } from "@/server/http/errors";
import { buildTemplateCriteria } from "@/server/vision/criteria-templates";

let db: ProofPayDb;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

function createTestJob(id = "job-1") {
  return createJob(
    {
      id,
      title: "Replace bike chain",
      description: "Swap the worn chain for a new one.",
      category: "bike_repair",
      amountCents: 6000,
      currency: "USD",
      criteria: buildTemplateCriteria("bike_repair"),
    },
    db,
  );
}

/** Shortest legal path CREATED → target, for table-driven transition tests. */
function pathTo(target: EscrowStatus): EscrowStatus[] {
  const queue: EscrowStatus[][] = [["CREATED"]];
  const seen = new Set<EscrowStatus>(["CREATED"]);
  while (queue.length > 0) {
    const path = queue.shift() as EscrowStatus[];
    const last = path[path.length - 1];
    if (last === target) return path;
    for (const next of TRANSITIONS[last]) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  throw new Error(`no path from CREATED to ${target}`);
}

function moveTo(jobId: string, target: EscrowStatus): void {
  const path = pathTo(target);
  for (const next of path.slice(1)) {
    transition(jobId, next, "system", { test: true }, db);
  }
}

describe("transition", () => {
  it("moves a job and appends an atomic STATUS_CHANGED event", () => {
    const job = createTestJob();
    const updated = transition(
      job.id,
      "AUTHORIZED",
      "customer",
      { authorizationId: "MOCK-AUTH-1" },
      db,
    );
    expect(updated.status).toBe("AUTHORIZED");
    expect(updated.events).toHaveLength(2);
    const event = updated.events.at(-1);
    expect(event).toMatchObject({
      type: "STATUS_CHANGED",
      fromStatus: "CREATED",
      toStatus: "AUTHORIZED",
      actor: "customer",
    });
    expect(event?.data).toEqual({ authorizationId: "MOCK-AUTH-1" });
  });

  it("throws IllegalTransition and writes nothing for a forbidden move", () => {
    const job = createTestJob();
    expect(() => transition(job.id, "CAPTURED", "system", {}, db)).toThrow(
      IllegalTransition,
    );
    expect(() => transition(job.id, "CAPTURED", "system", {}, db)).toThrow(
      /CREATED to CAPTURED/,
    );
    const after = transition(job.id, "AUTHORIZED", "customer", {}, db);
    expect(after.events).toHaveLength(2);
  });

  it("throws NotFoundError for an unknown job", () => {
    expect(() => transition("nope", "AUTHORIZED", "customer", {}, db)).toThrow(
      NotFoundError,
    );
  });

  it("rejects a stale writer (row changed since the status was read)", () => {
    const job = createTestJob();
    transition(job.id, "AUTHORIZED", "customer", {}, db);
    // Two writers race: the second one still believes the job is CREATED.
    transition(job.id, "EVIDENCE_SUBMITTED", "worker", {}, db);
    expect(() =>
      transition(job.id, "AUTHORIZED", "customer", {}, db),
    ).toThrow(IllegalTransition);
  });

  it.each([
    "AUTHORIZED",
    "EVIDENCE_SUBMITTED",
    "VERIFYING",
    "APPROVED",
    "PARTIAL",
    "REJECTED",
    "HUMAN_REVIEW",
    "CAPTURED",
    "VOIDED",
    "CANCELLED",
    "REFUNDED",
  ] as EscrowStatus[])("reaches %s through the MANUAL §7 path", (target) => {
    const job = createTestJob();
    moveTo(job.id, target);
    const after = getJob(job.id, db);
    expect(after?.status).toBe(target);
    expect(after?.events.at(-1)?.toStatus).toBe(target);
  });

  it("covers every allowed transition exactly like the shared table", () => {
    for (const from of Object.keys(TRANSITIONS) as EscrowStatus[]) {
      for (const to of TRANSITIONS[from]) {
        db = createDb(":memory:");
        runMigrations(db);
        const job = createTestJob();
        moveTo(job.id, from);
        const updated = transition(job.id, to, "system", {}, db);
        expect(updated.status, `${from} -> ${to}`).toBe(to);
      }
    }
  });
});
