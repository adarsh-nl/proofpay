import { NextResponse } from "next/server";
import {
  EvidencePhaseSchema,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_FILES_PER_PHASE,
} from "@/shared/contracts";
import { listEvidence } from "@/server/db/repo";
import { ValidationError } from "@/server/http/errors";
import { requireRole } from "@/server/http/role";
import { assertContentLength, withErrors } from "@/server/http/with-errors";
import { addEvidence } from "@/server/jobs/evidence";
import { requireJob } from "@/server/jobs/jobs";

const MAX_UPLOAD_REQUEST_BYTES = MAX_EVIDENCE_FILES_PER_PHASE * MAX_EVIDENCE_BYTES + 1024 * 1024;

/** MANUAL §8 #7: multipart upload, fields `phase` and `files` (repeatable). */
export const POST = withErrors<{ id: string }>(async (req, ctx) => {
  requireRole(req, "worker");
  const { id } = await ctx.params;
  // Refuse an oversized upload before buffering it (4 files of 8 MB plus multipart overhead).
  assertContentLength(req, MAX_UPLOAD_REQUEST_BYTES);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ValidationError("Send the photos as multipart/form-data.", "INVALID_MULTIPART");
  }
  const phase = EvidencePhaseSchema.parse(form.get("phase"));
  const files = [...form.getAll("files"), ...form.getAll("files[]")].filter(
    (entry): entry is File => entry instanceof File,
  );
  if (files.length > MAX_EVIDENCE_FILES_PER_PHASE) {
    throw new ValidationError(
      `At most ${MAX_EVIDENCE_FILES_PER_PHASE} photos per upload.`,
      "TOO_MANY_FILES",
    );
  }
  const evidence = await addEvidence(id, phase, files);
  return NextResponse.json({ evidence }, { status: 201 });
});

/** List a job's evidence in upload order (B1..Bn / A1..An follow this order per phase). */
export const GET = withErrors<{ id: string }>(async (_req, ctx) => {
  const { id } = await ctx.params;
  requireJob(id);
  return NextResponse.json({ evidence: listEvidence(id) });
});
