import { NextResponse } from "next/server";
import { AuthorizeBodySchema } from "@/shared/contracts";
import { jobForRole } from "@/server/http/job-view";
import { requireRole } from "@/server/http/role";
import { readJson, withErrors } from "@/server/http/with-errors";
import { authorizeOrder } from "@/server/paypal/orders";

/** MANUAL §8 #6: authorize the approved order and move the job to AUTHORIZED. */
export const POST = withErrors<{ orderId: string }>(async (req, ctx) => {
  const role = requireRole(req, "customer");
  const { orderId } = await ctx.params;
  const { jobId } = AuthorizeBodySchema.parse(await readJson(req));
  const job = await authorizeOrder(orderId, jobId);
  return NextResponse.json({ job: jobForRole(job, role) }, { status: 200 });
});
