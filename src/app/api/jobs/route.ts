import { NextResponse } from "next/server";
import { CreateJobBodySchema } from "@/shared/contracts";
import { listJobs } from "@/server/db/repo";
import { jobForRole } from "@/server/http/job-view";
import { requireRole } from "@/server/http/role";
import { readJson, withErrors } from "@/server/http/with-errors";
import { createJobFromBody } from "@/server/jobs/jobs";

export const dynamic = "force-dynamic";

/** MANUAL §8 #1: create a job with an acceptance checklist. */
export const POST = withErrors(async (req) => {
  const role = requireRole(req, "customer");
  const body = CreateJobBodySchema.parse(await readJson(req));
  const job = await createJobFromBody(body);
  return NextResponse.json({ job: jobForRole(job, role) }, { status: 201 });
});

/** MANUAL §8 #2: list jobs, newest first. */
export const GET = withErrors(async () => {
  return NextResponse.json({ jobs: listJobs() });
});
