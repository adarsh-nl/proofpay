import type { JobCategory } from "@/shared/contracts";
import { getDb, type ProofPayDb } from "./client";
import { createJob, getJob } from "./repo";
import { buildTemplateCriteria } from "../vision/criteria-templates";

export interface DemoJob {
  id: string;
  title: string;
  description: string;
  category: JobCategory;
  amountCents: number;
}

/** Stable demo ids (shared prompt C4); `eval` and the e2e specs rely on them. */
export const DEMO_JOBS: readonly DemoJob[] = [
  {
    id: "demo-bike",
    title: "Replace bike chain",
    description:
      "Replace the worn chain on my commuter bike and leave the drivetrain clean.",
    category: "bike_repair",
    amountCents: 6000,
  },
  {
    id: "demo-cleaning",
    title: "Apartment deep clean",
    description:
      "Deep clean the apartment: floors, surfaces, bathroom, oven interior and rubbish.",
    category: "cleaning",
    amountCents: 12000,
  },
  {
    id: "demo-delivery",
    title: "Parcel delivery to the front door",
    description:
      "Deliver the parcel to the front door and leave it out of the rain.",
    category: "delivery",
    amountCents: 4500,
  },
];

export interface SeedResult {
  created: string[];
  skipped: string[];
}

/**
 * Seed the three demo jobs in `CREATED` with their category template criteria.
 * Idempotent: existing demo ids are skipped.
 */
export function seedDemoJobs(db: ProofPayDb = getDb()): SeedResult {
  const currency = process.env.CURRENCY || "USD";
  const created: string[] = [];
  const skipped: string[] = [];
  for (const demo of DEMO_JOBS) {
    if (getJob(demo.id, db)) {
      skipped.push(demo.id);
      continue;
    }
    createJob(
      {
        id: demo.id,
        title: demo.title,
        description: demo.description,
        category: demo.category,
        amountCents: demo.amountCents,
        currency,
        customerName: "Demo customer",
        workerName: "Demo worker",
        criteria: buildTemplateCriteria(demo.category),
      },
      db,
    );
    created.push(demo.id);
  }
  console.info(
    `[seed] demo jobs: ${created.length} created, ${skipped.length} already present`,
  );
  return { created, skipped };
}
