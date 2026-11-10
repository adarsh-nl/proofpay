import { NextResponse } from "next/server";
import { UpdateCriteriaBodySchema } from "@/shared/contracts";
import { jobForRole } from "@/server/http/job-view";
import { requireRole } from "@/server/http/role";
import { readJson, withErrors } from "@/server/http/with-errors";
import { updateCriteria } from "@/server/jobs/jobs";

/** MANUAL §8 #4: replace the checklist while the job is CREATED. */
export const PUT = withErrors<{ id: string }>(async (req, ctx) => {
  const role = requireRole(req, "customer");
  const { id } = await ctx.params;
  const { criteria } = UpdateCriteriaBodySchema.parse(await readJson(req));
  return NextResponse.json({ job: jobForRole(updateCriteria(id, criteria), role) });
});
