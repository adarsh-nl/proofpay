import { vi } from "vitest";
import { getDb, resetDbForTests, runMigrations, type ProofPayDb } from "@/server/db/client";
import { createJob } from "@/server/db/repo";
import { resetEnvCache } from "@/server/env";
import { resetPayPalMock } from "@/server/paypal/mock";
import { buildTemplateCriteria } from "@/server/vision/criteria-templates";
import type { Job, JobCategory, Role } from "@/shared/contracts";

/**
 * Fresh in-memory database behind the `getDb()` singleton, plus mock PayPal
 * and mock vision. Call from `beforeEach`; pair with `teardownTestApp()`.
 */
export function setupTestApp(env: Record<string, string> = {}): ProofPayDb {
  vi.stubEnv("DATABASE_PATH", ":memory:");
  vi.stubEnv("PAYPAL_MOCK", "1");
  vi.stubEnv("VISION_MOCK", "1");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  resetEnvCache();
  resetDbForTests();
  resetPayPalMock();
  const db = getDb();
  runMigrations(db);
  return db;
}

export function teardownTestApp(): void {
  vi.unstubAllEnvs();
  resetEnvCache();
  resetDbForTests();
}

export function makeJob(
  overrides: { id?: string; category?: JobCategory; amountCents?: number; title?: string } = {},
): Job {
  const category = overrides.category ?? "bike_repair";
  return createJob({
    id: overrides.id,
    title: overrides.title ?? "Replace bike chain",
    description: "Fit a new chain and lubricate the drivetrain.",
    category,
    amountCents: overrides.amountCents ?? 6000,
    currency: "USD",
    criteria: buildTemplateCriteria(category),
  });
}

/** Build a Request for a route handler, with the `pp_role` cookie and a JSON body. */
export function apiRequest(
  path: string,
  options: {
    method?: string;
    role?: Role;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Request {
  const headers = new Headers(options.headers);
  if (options.role) headers.set("cookie", `pp_role=${options.role}`);
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }
  return new Request(`http://localhost${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body,
  });
}

export const params = <P>(value: P): { params: Promise<P> } => ({ params: Promise.resolve(value) });

export async function jsonOf<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
