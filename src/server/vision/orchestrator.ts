import "server-only";
import { getDb, type ProofPayDb } from "@/server/db/client";
import { getJob } from "@/server/db/repo";
import { transition } from "@/server/escrow/machine";

/**
 * Verification orchestrator.
 */
// TODO(T13): replace this stub with verify → forensics → decide → settle.
export async function runVerification(jobId: string, db: ProofPayDb = getDb()): Promise<void> {
  const job = getJob(jobId, db);
  if (!job || job.status !== "EVIDENCE_SUBMITTED") return;
  transition(jobId, "VERIFYING", "system", { stub: true }, db);
  console.info(`[orchestrator] job ${jobId} is VERIFYING (pipeline not wired yet)`);
}
