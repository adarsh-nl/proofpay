import { NextResponse } from "next/server";
import { ReviewBodySchema } from "@/shared/contracts";
import { jobForRole } from "@/server/http/job-view";
import { requireReviewer } from "@/server/http/role";
import { readJson, withErrors } from "@/server/http/with-errors";
import { reviewJob } from "@/server/jobs/settlement";

/** MANUAL §8 #13: reviewer decision, settled with PayPal in the same request. */
export const POST = withErrors<{ id: string }>(async (req, ctx) => {
  const role = requireReviewer(req);
  const { id } = await ctx.params;
  const body = ReviewBodySchema.parse(await readJson(req));
  return NextResponse.json({ job: jobForRole(await reviewJob(id, body), role) });
});
