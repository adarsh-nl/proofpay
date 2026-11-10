import { NextResponse } from "next/server";
import { VoidBodySchema } from "@/shared/contracts";
import { jobForRole } from "@/server/http/job-view";
import { requireReviewer, requireRole } from "@/server/http/role";
import { readJson, withErrors } from "@/server/http/with-errors";
import { voidJob } from "@/server/jobs/settlement";

/** MANUAL §8 #14: void the PayPal authorization (customer or reviewer). */
export const POST = withErrors<{ id: string }>(async (req, ctx) => {
  const role = requireRole(req, "customer", "reviewer");
  if (role === "reviewer") requireReviewer(req);
  const { id } = await ctx.params;
  const { reason } = VoidBodySchema.parse(await readJson(req));
  const job = await voidJob(id, reason, role === "reviewer" ? "reviewer" : "customer");
  return NextResponse.json({ job: jobForRole(job, role) });
});
