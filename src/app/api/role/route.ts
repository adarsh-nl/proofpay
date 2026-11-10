import { NextResponse } from "next/server";
import { RoleBodySchema } from "@/shared/contracts";
import { ROLE_COOKIE } from "@/server/http/role";
import { readJson, withErrors } from "@/server/http/with-errors";

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

/** Set the demo role cookie (`pp_role`, path /, SameSite=Lax, 7 days). Not authentication. */
export const POST = withErrors(async (req) => {
  const { role } = RoleBodySchema.parse(await readJson(req));
  const res = NextResponse.json({ role });
  res.cookies.set(ROLE_COOKIE, role, {
    path: "/",
    sameSite: "lax",
    maxAge: SEVEN_DAYS_SECONDS,
  });
  return res;
});
