import { beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  runMigrations,
  type ProofPayDb,
} from "@/server/db/client";
import { getJob, listJobs } from "@/server/db/repo";
import { DEMO_JOBS, seedDemoJobs } from "@/server/db/seed";
import {
  CATEGORY_TEMPLATE_CRITERIA,
  LIVENESS_CRITERION_TEMPLATE,
  applyLivenessCode,
  buildTemplateCriteria,
} from "@/server/vision/criteria-templates";
import { JOB_CATEGORIES } from "@/shared/contracts";

let db: ProofPayDb;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
});

describe("category criteria templates (shared prompt C5)", () => {
  it("has a template for every job category", () => {
    expect(Object.keys(CATEGORY_TEMPLATE_CRITERIA).sort()).toEqual(
      [...JOB_CATEGORIES].sort(),
    );
  });

  it("gives every category weights that sum to exactly 1 (integer thousandths)", () => {
    for (const category of JOB_CATEGORIES) {
      const thousandths = CATEGORY_TEMPLATE_CRITERIA[category].reduce(
        (sum, criterion) => sum + Math.round(criterion.weight * 1000),
        0,
      );
      expect(thousandths, category).toBe(1000);
    }
  });

  it("appends the required, weight-0 liveness criterion last", () => {
    for (const category of JOB_CATEGORIES) {
      const criteria = buildTemplateCriteria(category);
      const last = criteria.at(-1);
      expect(last?.id).toBe("cL");
      expect(last?.required).toBe(true);
      expect(last?.weight).toBe(0);
      expect(last?.source).toBe("system");
      expect(last?.label).toContain("{CODE}");
      expect(criteria.filter((c) => c.id === "cL")).toHaveLength(1);
    }
  });

  it("marks the C5 required flags exactly", () => {
    const cleaning = buildTemplateCriteria("cleaning");
    for (const id of ["c2", "c4"]) {
      expect(cleaning.find((c) => c.id === id)?.required, id).toBe(false);
    }
    for (const id of ["c1", "c3", "c5"]) {
      expect(cleaning.find((c) => c.id === id)?.required, id).toBe(true);
    }
    const delivery = buildTemplateCriteria("delivery");
    expect(delivery.filter((c) => c.required).map((c) => c.id)).toEqual([
      "c1",
      "c2",
      "cL",
    ]);
  });

  it("keeps the C5 liveness label and fills the real code", () => {
    expect(LIVENESS_CRITERION_TEMPLATE.label).toContain(
      "Liveness code {CODE} visible in at least one after photo",
    );
    const criteria = applyLivenessCode(buildTemplateCriteria("bike_repair"), "4821");
    expect(criteria.at(-1)?.label).toContain("4821");
    expect(criteria.at(-1)?.label).not.toContain("{CODE}");
  });
});

describe("seedDemoJobs (shared prompt C4)", () => {
  it("seeds the three demo jobs in CREATED with template criteria", () => {
    const result = seedDemoJobs(db);
    expect(result.created).toEqual(["demo-bike", "demo-cleaning", "demo-delivery"]);
    expect(DEMO_JOBS.map((job) => job.id)).toEqual(result.created);

    const jobs = listJobs(undefined, db);
    expect(jobs).toHaveLength(3);
    expect(jobs.every((job) => job.status === "CREATED")).toBe(true);

    const bike = getJob("demo-bike", db);
    expect(bike?.category).toBe("bike_repair");
    expect(bike?.amount).toEqual({ currency: "USD", value: "60.00" });
    expect(bike?.criteria).toHaveLength(5);

    const cleaning = getJob("demo-cleaning", db);
    expect(cleaning?.amount).toEqual({ currency: "USD", value: "120.00" });
    expect(cleaning?.criteria).toHaveLength(6);
    expect(cleaning?.criteria.at(-1)?.id).toBe("cL");

    const delivery = getJob("demo-delivery", db);
    expect(delivery?.category).toBe("delivery");
    expect(delivery?.amount).toEqual({ currency: "USD", value: "45.00" });
  });

  it("is idempotent", () => {
    seedDemoJobs(db);
    const second = seedDemoJobs(db);
    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(["demo-bike", "demo-cleaning", "demo-delivery"]);
    expect(listJobs(undefined, db)).toHaveLength(3);
  });
});
