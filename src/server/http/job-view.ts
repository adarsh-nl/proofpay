import "server-only";
import type { Job, Role } from "@/shared/contracts";

/** The liveness code is shown to the worker and the reviewer only (C9). */
export function jobForRole(job: Job, role: Role | undefined): Job {
  if (role === "worker" || role === "reviewer") return job;
  const { livenessCode: _hidden, ...rest } = job;
  void _hidden;
  return rest;
}
