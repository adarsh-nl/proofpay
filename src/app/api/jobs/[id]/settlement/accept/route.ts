import { NextResponse } from "next/server";
import { AcceptBodySchema } from "@/shared/contracts";
import { jobForRole } from "@/server/http/job-view";
import { requireRole } from "@/server/http/role";
import { readJson, withErrors } from "@/server/http/with-errors";
import { acceptProposal } from "@/server/jobs/settlement";

/** MANUAL §8 #11: the customer's click that approves the partial capture. */
export const POST = withErrors<{ id: string }>(async (req, ctx) => {
  const role = requireRole(req, "customer");
  const { id } = await ctx.params;
  const { proposalId } = AcceptBodySchema.parse(await readJson(req));
  return NextResponse.json({ job: jobForRole(await acceptProposal(id, proposalId), role) });
});
