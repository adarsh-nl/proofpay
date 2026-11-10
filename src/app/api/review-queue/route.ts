import { NextResponse } from "next/server";
import { listJobs } from "@/server/db/repo";
import { requireReviewer } from "@/server/http/role";
import { withErrors } from "@/server/http/with-errors";

export const dynamic = "force-dynamic";

/** MANUAL §8 #17: jobs waiting for a human reviewer. */
export const GET = withErrors(async (req) => {
  requireReviewer(req);
  return NextResponse.json({ jobs: listJobs("HUMAN_REVIEW") });
});
