import "server-only";
import { unlink } from "node:fs/promises";
import path from "node:path";
import {
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_FILES_PER_PHASE,
  type EvidenceItem,
  type EvidencePhase,
  type Job,
} from "@/shared/contracts";
import { getDb, type ProofPayDb } from "@/server/db/client";
import { deleteEvidence, insertEvidence, listEvents, listEvidence } from "@/server/db/repo";
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
  return path.resolve(process.cwd(), getEnv().UPLOAD_DIR);
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
  const file = path.join(uploadRoot(), jobId, path.basename(item.url));
  await unlink(file).catch(() => undefined);
}

/**
 * MANUAL §8 #9: needs at least one after photo, moves the job to
 * `EVIDENCE_SUBMITTED` and starts verification in the background.
 */
export function submitEvidence(
  jobId: string,
  actor: Actor = "worker",
  db: ProofPayDb = getDb(),
): Job {
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
  const submitted = transition(
    jobId,
    "EVIDENCE_SUBMITTED",
    actor,
    { before: evidence.length - after, after, attempt: submissions + 1 },
    db,
  );
  void runVerification(jobId, db).catch((error: unknown) => {
    console.error("[evidence] verification failed to start", error);
  });
  return submitted;
}
