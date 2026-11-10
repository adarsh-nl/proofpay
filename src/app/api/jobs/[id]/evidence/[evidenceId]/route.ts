import { requireRole } from "@/server/http/role";
import { withErrors } from "@/server/http/with-errors";
import { removeEvidence } from "@/server/jobs/evidence";

/** MANUAL §8 #8: remove one photo before the evidence is submitted. */
export const DELETE = withErrors<{ id: string; evidenceId: string }>(async (req, ctx) => {
  requireRole(req, "worker");
  const { id, evidenceId } = await ctx.params;
  await removeEvidence(id, evidenceId);
  return new Response(null, { status: 204 });
});
