import { NextResponse } from "next/server";
import { jobForRole } from "@/server/http/job-view";
import { viewerRole } from "@/server/http/role";
import { withErrors } from "@/server/http/with-errors";
import { requireJob } from "@/server/jobs/jobs";

/** MANUAL §8 #3: job detail. The liveness code is only sent to worker and reviewer. */
export const GET = withErrors<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  return NextResponse.json({ job: jobForRole(requireJob(id), viewerRole(req)) });
});
