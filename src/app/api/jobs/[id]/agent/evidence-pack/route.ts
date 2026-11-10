import { NextResponse } from "next/server";
import { EvidencePackBodySchema } from "@/shared/contracts";
import { buildEvidencePack } from "@/server/agent/evidence-pack";
import { requireReviewer } from "@/server/http/role";
import { readJson, withErrors } from "@/server/http/with-errors";

/** MANUAL §8 #18: Markdown evidence pack for the reviewer (and PayPal disputes). */
export const POST = withErrors<{ id: string }>(async (req, ctx) => {
  requireReviewer(req);
  const { id } = await ctx.params;
  EvidencePackBodySchema.parse(await readJson(req));
  return NextResponse.json({ markdown: await buildEvidencePack(id) });
});
