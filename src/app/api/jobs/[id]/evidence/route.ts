import { NextResponse } from "next/server";
import { EvidencePhaseSchema } from "@/shared/contracts";
import { listEvidence } from "@/server/db/repo";
import { ValidationError } from "@/server/http/errors";
import { requireRole } from "@/server/http/role";
import { withErrors } from "@/server/http/with-errors";
import { addEvidence } from "@/server/jobs/evidence";
import { requireJob } from "@/server/jobs/jobs";

/** MANUAL §8 #7: multipart upload, fields `phase` and `files` (repeatable). */
export const POST = withErrors<{ id: string }>(async (req, ctx) => {
  requireRole(req, "worker");
  const { id } = await ctx.params;
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
  const evidence = await addEvidence(id, phase, files);
  return NextResponse.json({ evidence }, { status: 201 });
});

/** List a job's evidence in upload order (B1..Bn / A1..An follow this order per phase). */
export const GET = withErrors<{ id: string }>(async (_req, ctx) => {
  const { id } = await ctx.params;
  requireJob(id);
  return NextResponse.json({ evidence: listEvidence(id) });
});
