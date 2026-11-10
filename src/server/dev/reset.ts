import "server-only";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { JobListItem } from "@/shared/contracts";
import { getDb, type ProofPayDb } from "@/server/db/client";
import { listJobs } from "@/server/db/repo";
import * as t from "@/server/db/schema";
import { seedDemoJobs } from "@/server/db/seed";
import { getEnv } from "@/server/env";
import { uploadRoot } from "@/server/jobs/evidence";
import { resetPayPalMock } from "@/server/paypal/mock";
import { voidAuthorization } from "@/server/paypal/payments";

/**
 * Demo reset (`POST /api/dev/reset`, off unless `DEMO_RESET_ENABLED=1`):
 * releases any PayPal hold that is still open, deletes every job and uploaded
 * photo, and seeds the three demo jobs again.
 */

export type DemoResetResult = { jobs: JobListItem[]; releasedHolds: number; deletedJobs: number };

/** Holds that were authorized but neither captured nor voided. */
function openAuthorizations(db: ProofPayDb): Array<{ jobId: string; authorizationId: string }> {
  return db
    .select()
    .from(t.payments)
    .all()
    .filter((row) => row.authorizationId && !row.voidedAt && row.capturedCents === 0)
    .map((row) => ({ jobId: row.jobId, authorizationId: row.authorizationId as string }));
}

async function clearUploads(): Promise<void> {
  const root = uploadRoot();
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(root)) {
    await rm(path.join(/* turbopackIgnore: true */ root, entry), { recursive: true, force: true });
  }
}

export async function resetDemoData(db: ProofPayDb = getDb()): Promise<DemoResetResult> {
  let releasedHolds = 0;
  if (getEnv().PAYPAL_MOCK) {
    resetPayPalMock();
  } else {
    // Best effort: do not leave sandbox holds behind for jobs that are about to disappear.
    for (const hold of openAuthorizations(db)) {
      try {
        await voidAuthorization(hold.authorizationId, { jobId: hold.jobId, attempt: 1, db });
        releasedHolds += 1;
      } catch (error) {
        console.warn(
          `[dev-reset] could not void the hold of job ${hold.jobId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const deletedJobs = db.select({ id: t.jobs.id }).from(t.jobs).all().length;
  db.transaction((tx) => {
    tx.delete(t.events).run();
    tx.delete(t.verifications).run();
    tx.delete(t.evidence).run();
    tx.delete(t.payments).run();
    tx.delete(t.criteria).run();
    tx.delete(t.paypalIdempotency).run();
    tx.delete(t.jobs).run();
  });
  await clearUploads();
  seedDemoJobs(db);
  console.info(`[dev-reset] demo data reset: ${deletedJobs} jobs deleted, ${releasedHolds} holds released`);
  return { jobs: listJobs(undefined, db), releasedHolds, deletedJobs };
}
