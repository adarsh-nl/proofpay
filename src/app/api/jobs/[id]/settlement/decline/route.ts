import { NextResponse } from "next/server";
import { DeclineBodySchema } from "@/shared/contracts";
import { jobForRole } from "@/server/http/job-view";
import { requireRole } from "@/server/http/role";
import { readJson, withErrors } from "@/server/http/with-errors";
import { declineProposal } from "@/server/jobs/settlement";

/** MANUAL §8 #12: decline the proposal; the job goes to a human reviewer. */
export const POST = withErrors<{ id: string }>(async (req, ctx) => {
  const role = requireRole(req, "customer", "worker");
  const { id } = await ctx.params;
  const { proposalId, reason } = DeclineBodySchema.parse(await readJson(req));
  const job = declineProposal(id, proposalId, reason, role === "worker" ? "worker" : "customer");
  return NextResponse.json({ job: jobForRole(job, role) });
});
