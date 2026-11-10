import { NextResponse } from "next/server";
import { jobForRole } from "@/server/http/job-view";
import { requireReviewer } from "@/server/http/role";
import { withErrors } from "@/server/http/with-errors";
import { reauthorizeJob } from "@/server/jobs/reauthorize";

/** MANUAL §8 #16: reviewer restarts the honor period with a new PayPal authorization. */
export const POST = withErrors<{ id: string }>(async (req, ctx) => {
  const role = requireReviewer(req);
  const { id } = await ctx.params;
  return NextResponse.json({ job: jobForRole(await reauthorizeJob(id), role) });
});
