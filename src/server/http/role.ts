import "server-only";
import { RoleSchema, type Role } from "@/shared/contracts";
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
