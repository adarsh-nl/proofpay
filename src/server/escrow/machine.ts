import "server-only";
import { canTransition, type EscrowStatus } from "@/shared/escrow";
import type { Job } from "@/shared/contracts";
import { getDb, type ProofPayDb } from "@/server/db/client";
import { getJob, insertEvent, setStatus } from "@/server/db/repo";
import { NotFoundError } from "@/server/http/errors";

export type Actor = "customer" | "worker" | "reviewer" | "system" | "agent";

/** The escrow table (`src/shared/escrow.ts`) does not allow `from → to`. Maps to 409. */
export class IllegalTransition extends Error {
  constructor(
    public readonly from: EscrowStatus,
    public readonly to: EscrowStatus,
  ) {
    super(`Cannot move a job from ${from} to ${to}`);
    this.name = "IllegalTransition";
  }
}

/**
 * The only place a job status changes. One SQLite transaction: read the
 * status, check the allowed-transitions table, update `jobs.status` and append
 * a `STATUS_CHANGED` event.
 */
// TODO(T06): settle() and the approval-gated transitions build on this.
export function transition(
  jobId: string,
  to: EscrowStatus,
  actor: Actor,
  data: unknown = {},
  db: ProofPayDb = getDb(),
): Job {
  return db.transaction((tx) => {
    // Repo helpers only use the query-builder surface shared by db and tx.
    const conn = tx as unknown as ProofPayDb;
    const job = getJob(jobId, conn);
    if (!job) throw new NotFoundError("Job");
    if (!canTransition(job.status, to)) throw new IllegalTransition(job.status, to);
    setStatus(jobId, to, conn);
    insertEvent(
      { jobId, type: "STATUS_CHANGED", fromStatus: job.status, toStatus: to, actor, data },
      conn,
    );
    const updated = getJob(jobId, conn);
    if (!updated) throw new NotFoundError("Job");
    return updated;
  });
}
