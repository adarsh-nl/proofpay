import { NextResponse } from "next/server";
import { SubmitBodySchema } from "@/shared/contracts";
import { jobForRole } from "@/server/http/job-view";
import { requireRole } from "@/server/http/role";
import { readJson, withErrors } from "@/server/http/with-errors";
import { submitEvidence } from "@/server/jobs/evidence";

/** MANUAL §8 #9: submit the evidence; verification runs in-process and the UI polls. */
export const POST = withErrors<{ id: string }>(async (req, ctx) => {
  const role = requireRole(req, "worker");
  const { id } = await ctx.params;
  SubmitBodySchema.parse(await readJson(req));
  return NextResponse.json({ job: jobForRole(await submitEvidence(id), role) }, { status: 202 });
});
