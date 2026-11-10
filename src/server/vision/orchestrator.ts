import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  Decision,
  ForensicsReport,
  Job,
  VerificationBundle,
  VerificationReport,
} from "@/shared/contracts";
import { toCents } from "@/shared/money";
import { runSettlementAgent } from "@/server/agent/settlement-agent";
import { getDb, type ProofPayDb } from "@/server/db/client";
import {
  getJob,
  insertVerification,
  listEvidenceRows,
  listVerifications,
} from "@/server/db/repo";
import type { EvidenceRow } from "@/server/db/schema";
import { getEnv, getThresholds } from "@/server/env";
import { transition } from "@/server/escrow/machine";
import { onApproved } from "@/server/escrow/settle";
import { decide } from "./decide";
import {
  loadStockHashes,
  runForensics,
  type ForensicsEvidence,
} from "./forensics";
import { verifyEvidence, type VerifyImage } from "./verify";

/**
 * Verification orchestrator (docs/MANUAL.md §9): EVIDENCE_SUBMITTED → VERIFYING
 * → (APPROVED | PARTIAL | REJECTED | HUMAN_REVIEW), storing the bundle.
 *
 * - `VISION_MOCK=1` means the deterministic mock report (C6); no AI/network call.
 * - Any thrown error moves the job to HUMAN_REVIEW with the reason in the event,
 *   so a job is never stuck in VERIFYING.
 * - APPROVED auto-captures via `onApproved()` when `AUTO_CAPTURE_ON_APPROVE=1`.
 */

export interface RunVerificationDeps {
  /** Test seam: replace the VLM call (e.g. to simulate a VLM failure). */
  verifier?: typeof verifyEvidence;
  /** Test seam: stock images directory for the duplicate checks. */
  stockDir?: string;
  /** Test seam: absolute upload directory (defaults to `UPLOAD_DIR`). */
  uploadDir?: string;
}

export interface RunVerificationOptions extends RunVerificationDeps {
  /** Reviewer-triggered re-run: allows a second attempt while still EVIDENCE_SUBMITTED. */
  force?: boolean;
  db?: ProofPayDb;
}

export interface VerificationOutcome {
  verification: VerificationBundle;
  job: Job;
  decision: Decision;
}

/** Authorization time from the job timeline (`STATUS_CHANGED` → AUTHORIZED). */
export function authorizedAtFromJob(job: Job): string | null {
  const event = job.events.find(
    (item) => item.type === "STATUS_CHANGED" && item.toStatus === "AUTHORIZED",
  );
  return event?.createdAt ?? null;
}

function toForensicsEvidence(row: EvidenceRow): ForensicsEvidence {
  return {
    id: row.id,
    jobId: row.jobId,
    phase: row.phase === "before" ? "before" : "after",
    sha256: row.sha256,
    dhash: row.dhash,
    exifTakenAt: row.exifTakenAt,
  };
}

async function loadImages(
  rows: EvidenceRow[],
  uploadDir: string,
): Promise<VerifyImage[]> {
  const images: VerifyImage[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    images.push({
      imageId: `${row.phase === "before" ? "B" : "A"}${index + 1}`,
      buffer: await readFile(resolve(uploadDir, row.path)),
      mimeType: "image/jpeg",
    });
  }
  return images;
}

async function failToHumanReview(
  jobId: string,
  error: unknown,
  db: ProofPayDb,
): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[orchestrator] verification failed for ${jobId}: ${reason}`);
  try {
    transition(
      jobId,
      "HUMAN_REVIEW",
      "system",
      { reason, code: "VERIFICATION_ERROR" },
      db,
    );
  } catch (transitionError) {
    // The job may already have left VERIFYING; never mask the original error.
    console.error(
      `[orchestrator] could not move ${jobId} to HUMAN_REVIEW: ${
        transitionError instanceof Error
          ? transitionError.message
          : String(transitionError)
      }`,
    );
  }
}

/**
 * Run the full verification pipeline for a job.
 *
 * Returns `null` when the job is not awaiting verification: the double-submit
 * path must never run or charge twice.
 */
export async function runVerification(
  jobId: string,
  options: RunVerificationOptions = {},
): Promise<VerificationOutcome | null> {
  const db = options.db ?? getDb();
  const env = getEnv();
  const job = getJob(jobId, db);
  if (!job) return null;
  if (job.status !== "EVIDENCE_SUBMITTED") {
    console.info(
      `[orchestrator] ${jobId} is ${job.status}; verification only runs from EVIDENCE_SUBMITTED`,
    );
    return null;
  }
  if (!options.force && job.latestVerification) {
    console.info(
      `[orchestrator] ${jobId} already has a verification; pass force to re-run`,
    );
    return null;
  }

  const attempt = listVerifications(jobId, db).length + 1;
  transition(jobId, "VERIFYING", "system", { attempt }, db);

  const verifier = options.verifier ?? verifyEvidence;
  const uploadDir = resolve(process.cwd(), options.uploadDir ?? env.UPLOAD_DIR);
  const stockDir = options.stockDir
    ? resolve(process.cwd(), options.stockDir)
    : undefined;

  let verification: VerificationBundle;
  let decision: Decision;
  try {
    const evidenceRows = listEvidenceRows(jobId, db);
    const beforeRows = evidenceRows.filter((row) => row.phase === "before");
    const afterRows = evidenceRows.filter((row) => row.phase === "after");
    if (afterRows.length === 0) {
      throw new Error("NO_AFTER_EVIDENCE: at least one after photo is required");
    }

    const beforeImages = await loadImages(beforeRows, uploadDir);
    const afterImages = await loadImages(afterRows, uploadDir);

    const report: VerificationReport = await verifier({
      criteria: job.criteria,
      before: beforeImages,
      after: afterImages,
      livenessCode: job.livenessCode ?? "",
      category: job.category,
      firstAfterSha256: afterRows[0]?.sha256 ?? null,
    });

    const otherRows = listEvidenceRows(undefined, db).filter(
      (row) => row.jobId !== jobId,
    );
    const stock = await loadStockHashes(stockDir).catch(() => []);
    const forensics: ForensicsReport = runForensics({
      job: { id: jobId },
      evidence: evidenceRows.map(toForensicsEvidence),
      otherEvidence: otherRows.map(toForensicsEvidence),
      stock,
      authorizedAt: authorizedAtFromJob(job),
      vlmReport: report,
    });

    decision = decide({
      criteria: job.criteria,
      report,
      forensics,
      amountCents: toCents(job.amount.value),
      currency: job.amount.currency,
      thresholds: getThresholds(),
    });

    verification = insertVerification(
      {
        jobId,
        attempt,
        model: env.VISION_MOCK ? "mock" : (env.VLM_MODEL ?? "unknown"),
        mock: env.VISION_MOCK,
        report,
        forensics,
        decision,
      },
      db,
    );
  } catch (error) {
    await failToHumanReview(jobId, error, db);
    return null;
  }

  const updated = transition(
    jobId,
    decision.outcome,
    "system",
    {
      verificationId: verification.id,
      score: decision.score,
      reasons: decision.reasons,
    },
    db,
  );

  if (decision.outcome === "APPROVED") {
    try {
      const captured = await onApproved(jobId, db);
      return { verification, job: captured, decision };
    } catch (error) {
      // settle() already logged a PAYPAL_CALL event; stay APPROVED so the UI
      // can retry the capture (e.g. after a PayPal outage).
      console.error(
        `[orchestrator] auto-capture failed for ${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { verification, job: updated, decision };
    }
  }

  try {
    await runSettlementAgent(jobId, db);
  } catch (error) {
    console.error(
      `[orchestrator] settlement agent failed for ${jobId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return { verification, job: updated, decision };
}
