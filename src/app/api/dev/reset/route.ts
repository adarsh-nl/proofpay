import { NextResponse } from "next/server";
import { resetDemoData } from "@/server/dev/reset";
import { getEnv } from "@/server/env";
import { NotFoundError } from "@/server/http/errors";
import { requireReviewer } from "@/server/http/role";
import { withErrors } from "@/server/http/with-errors";

export const dynamic = "force-dynamic";

/**
 * Reset the demo: delete all jobs and photos and seed the three demo jobs.
 * Reviewer only, and only when `DEMO_RESET_ENABLED=1`; otherwise the route
 * answers 404 as if it did not exist.
 */
export const POST = withErrors(async (req) => {
  if (!getEnv().DEMO_RESET_ENABLED) throw new NotFoundError("Route");
  requireReviewer(req);
  return NextResponse.json(await resetDemoData());
});
