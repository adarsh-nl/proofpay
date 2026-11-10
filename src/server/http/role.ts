import "server-only";
import { timingSafeEqual } from "node:crypto";
import { RoleSchema, type Role } from "@/shared/contracts";
import { getEnv } from "@/server/env";
import { PolicyError } from "./errors";

export const ROLE_COOKIE = "pp_role";

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Role from the `pp_role` cookie (demo-grade role switch, not authentication). */
export function getRole(req: Request): Role | undefined {
  const parsed = RoleSchema.safeParse(readCookie(req, ROLE_COOKIE));
  return parsed.success ? parsed.data : undefined;
}

/** Throws a 403 unless the request carries one of `roles`. */
export function requireRole(req: Request, ...roles: Role[]): Role {
  const role = getRole(req);
  if (!role || !roles.includes(role)) {
    throw new PolicyError(
      `This action needs the ${roles.join(" or ")} role. Switch role at /?as=${roles[0] ?? "customer"}.`,
      "FORBIDDEN_ROLE",
      { required: roles, actual: role ?? null },
    );
  }
  return role;
}

export const REVIEWER_PASSCODE_HEADER = "x-reviewer-passcode";

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Reviewer role, plus the `x-reviewer-passcode` header when `REVIEWER_PASSCODE`
 * is set (hosted demo gate, C8).
 */
export function requireReviewer(req: Request): Role {
  const role = requireRole(req, "reviewer");
  const passcode = getEnv().REVIEWER_PASSCODE;
  if (passcode) {
    const given = req.headers.get(REVIEWER_PASSCODE_HEADER) ?? "";
    if (!sameSecret(given, passcode)) {
      throw new PolicyError(
        "Reviewer passcode required. Enter the passcode to use the reviewer console.",
        "REVIEWER_PASSCODE_REQUIRED",
      );
    }
  }
  return role;
}
