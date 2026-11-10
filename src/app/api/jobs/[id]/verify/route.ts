import { NextResponse } from "next/server";
import { VerifyBodySchema } from "@/shared/contracts";
import { getJob } from "@/server/db/repo";
import { ConflictError, NotFoundError } from "@/server/http/errors";
import { requireReviewer } from "@/server/http/role";
import { readJson, withErrors } from "@/server/http/with-errors";
import { runVerification } from "@/server/vision/orchestrator";

/**
 * `POST /api/jobs/:id/verify` — reviewer re-run of the verification pipeline
 * (MANUAL §8 #10). Normal flow: the job must be EVIDENCE_SUBMITTED; `force`
 * allows an explicit second attempt (debug / demo) without waiting for a new
 * submission round.
 */
export const POST = withErrors<{ id: string }>(async (req, ctx) => {
  const role = requireReviewer(req);
  const { id } = await ctx.params;
  const body = VerifyBodySchema.parse(await readJson(req));

  const job = getJob(id);
  if (!job) throw new NotFoundError("Job");

  const outcome = await runVerification(id, { force: body.force === true });
  if (!outcome) {
    throw new ConflictError(
      `Job ${id} is not awaiting verification (status ${job.status}).`,
      "NOT_VERIFIABLE",
    );
  }
  console.info(
    `[api] verification re-run by ${role} for ${id}: ${outcome.decision.outcome}`,
  );
  return NextResponse.json({
    verification: outcome.verification,
    job: outcome.job,
  });
});
