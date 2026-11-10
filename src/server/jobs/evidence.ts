import "server-only";
import { rename, unlink } from "node:fs/promises";
import path from "node:path";
import {
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_FILES_PER_PHASE,
  type EvidenceItem,
  type EvidencePhase,
  type Job,
} from "@/shared/contracts";
import { getDb, type ProofPayDb } from "@/server/db/client";
import {
  deleteEvidence,
  insertEvidence,
  listEvents,
  listEvidence,
  listEvidenceRows,
  updateEvidencePath,
} from "@/server/db/repo";
import { getEnv } from "@/server/env";
import { transition, type Actor } from "@/server/escrow/machine";
import { ConflictError, HttpError, NotFoundError, ValidationError } from "@/server/http/errors";
import { IngestError, ingestImage } from "@/server/vision/ingest";
import { runVerification } from "@/server/vision/orchestrator";
import { requireJob } from "./jobs";

/** Evidence rules (C9): <= 4 files per phase, <= 8 MB each, jpeg/png/webp. */

const EDITABLE_STATUSES = ["AUTHORIZED", "REJECTED"] as const;
/** First submission plus one resubmission after a rejection (MANUAL §7). */
const MAX_SUBMISSIONS = 2;

export function uploadRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), getEnv().UPLOAD_DIR);
}

function requireEditable(job: Job): void {
  if (!(EDITABLE_STATUSES as readonly string[]).includes(job.status)) {
    throw new ConflictError(
      job.status === "CREATED"
        ? "Evidence can be uploaded once the customer's payment is held by PayPal."
        : `Evidence is locked while the job is ${job.status}.`,
      "EVIDENCE_LOCKED",
    );
  }
}

function isHeic(file: File): boolean {
  return /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

export async function addEvidence(
  jobId: string,
  phase: EvidencePhase,
  files: File[],
  db: ProofPayDb = getDb(),
): Promise<EvidenceItem[]> {
  const job = requireJob(jobId, db);
  requireEditable(job);
  if (files.length === 0) {
    throw new ValidationError("Attach at least one photo.", "NO_FILES");
  }
  const existing = listEvidence(jobId, db).filter((item) => item.phase === phase).length;
  if (existing + files.length > MAX_EVIDENCE_FILES_PER_PHASE) {
    throw new ValidationError(
      `At most ${MAX_EVIDENCE_FILES_PER_PHASE} ${phase} photos per job (${existing} already uploaded).`,
      "TOO_MANY_FILES",
    );
  }
  for (const file of files) {
    if (file.size > MAX_EVIDENCE_BYTES) {
      throw new HttpError(
        413,
        "FILE_TOO_LARGE",
        `"${file.name}" is larger than ${MAX_EVIDENCE_BYTES / 1024 / 1024} MB.`,
      );
    }
    if (isHeic(file)) {
      throw new ValidationError(
        `"${file.name}" is a HEIC photo, which is not supported yet. Upload a JPEG, PNG or WebP image.`,
        "UNSUPPORTED_FORMAT",
      );
    }
  }

  const uploadDir = uploadRoot();
  const stored: EvidenceItem[] = [];
  for (const file of files) {
    try {
      const image = await ingestImage(Buffer.from(await file.arrayBuffer()), {
        jobId,
        phase,
        uploadDir,
      });
      stored.push(
        insertEvidence(
          {
            jobId,
            phase,
            path: image.storedPath,
            mime: image.mime,
            width: image.width,
            height: image.height,
            sha256: image.sha256,
            dhash: image.dhash,
            exifTakenAt: image.exifTakenAt,
          },
          db,
        ),
      );
    } catch (error) {
      if (error instanceof IngestError) {
        throw new ValidationError(`"${file.name}": ${error.message}`, error.code);
      }
      throw error;
    }
  }
  return stored;
}

export async function removeEvidence(
  jobId: string,
  evidenceId: string,
  db: ProofPayDb = getDb(),
): Promise<void> {
  const job = requireJob(jobId, db);
  requireEditable(job);
  const item = listEvidence(jobId, db).find((candidate) => candidate.id === evidenceId);
  if (!item || !deleteEvidence(jobId, evidenceId, db)) throw new NotFoundError("Evidence");
  const file = path.join(/* turbopackIgnore: true */ uploadRoot(), jobId, path.basename(item.url));
  await unlink(file).catch(() => undefined);
}

/**
 * Renumber a job's stored photos so the n-th photo of a phase (in upload
 * order) is `<phase>_<n>.jpg`. The verifier calls images `B1..Bn` / `A1..An`
 * by that position and the UI loads `/api/uploads/<job>/<phase>_<n>.jpg`, so a
 * gap left by a deleted photo would point the viewer at the wrong file.
 */
export async function compactEvidenceFiles(jobId: string, db: ProofPayDb = getDb()): Promise<number> {
  const root = uploadRoot();
  const moves: Array<{ id: string; from: string; to: string }> = [];
  for (const phase of ["before", "after"] as const) {
    const rows = listEvidenceRows(jobId, db).filter((row) => row.phase === phase);
    rows.forEach((row, index) => {
      const to = `${jobId}/${phase}_${index + 1}.jpg`;
      if (row.path !== to) moves.push({ id: row.id, from: row.path, to });
    });
  }
  if (moves.length === 0) return 0;
  const abs = (relative: string) =>
    path.join(/* turbopackIgnore: true */ root, jobId, path.basename(relative));
  // Two passes, so a target name that is still in use by another move is never overwritten.
  for (const move of moves) await rename(abs(move.from), abs(`.moving-${move.id}.jpg`));
  for (const move of moves) {
    await rename(abs(`.moving-${move.id}.jpg`), abs(move.to));
    updateEvidencePath(move.id, move.to, db);
  }
  return moves.length;
}

/**
 * MANUAL §8 #9: needs at least one after photo, moves the job to
 * `EVIDENCE_SUBMITTED` and starts verification in the background.
 */
export async function submitEvidence(
  jobId: string,
  actor: Actor = "worker",
  db: ProofPayDb = getDb(),
): Promise<Job> {
  const job = requireJob(jobId, db);
  requireEditable(job);
  const evidence = listEvidence(jobId, db);
  const after = evidence.filter((item) => item.phase === "after").length;
  if (after === 0) {
    throw new ValidationError("Upload at least one AFTER photo before submitting.", "NO_AFTER_EVIDENCE");
  }
  const submissions = listEvents(jobId, db).filter(
    (event) => event.type === "STATUS_CHANGED" && event.toStatus === "EVIDENCE_SUBMITTED",
  ).length;
  if (submissions >= MAX_SUBMISSIONS) {
    throw new ConflictError(
      "This job has already been resubmitted once. Ask the customer or a reviewer to release the hold.",
      "RETRY_LIMIT_REACHED",
    );
  }
  await compactEvidenceFiles(jobId, db);
  const submitted = transition(
    jobId,
    "EVIDENCE_SUBMITTED",
    actor,
    { before: evidence.length - after, after, attempt: submissions + 1 },
    db,
  );
  void runVerification(jobId, { db }).catch((error: unknown) => {
    console.error("[evidence] verification failed to start", error);
  });
  return submitted;
}
