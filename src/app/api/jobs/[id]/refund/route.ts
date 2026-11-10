import { NextResponse } from "next/server";
import { RefundBodySchema } from "@/shared/contracts";
import { jobForRole } from "@/server/http/job-view";
import { requireReviewer } from "@/server/http/role";
import { readJson, withErrors } from "@/server/http/with-errors";
import { refundJob } from "@/server/jobs/settlement";

/** MANUAL §8 #15: reviewer refunds a captured payment (full when no amount). */
export const POST = withErrors<{ id: string }>(async (req, ctx) => {
  const role = requireReviewer(req);
  const { id } = await ctx.params;
  const { amount, reason } = RefundBodySchema.parse(await readJson(req));
  return NextResponse.json({ job: jobForRole(await refundJob(id, amount, reason), role) });
});
