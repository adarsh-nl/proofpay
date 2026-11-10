import { describe, expect, it } from "vitest";
import {
  ApiErrorSchema,
  CreateJobBodySchema,
  DecisionSchema,
  JobSchema,
  MoneySchema,
  ReviewBodySchema,
  VerificationReportSchema,
} from "@/shared/contracts";

const job = {
  id: "demo-bike",
  title: "Replace bike chain",
  description: "Swap the worn chain for a new one.",
  category: "bike_repair" as const,
  amount: { currency: "USD", value: "60.00" },
  status: "AUTHORIZED" as const,
  livenessCode: "4821",
  criteria: [
    {
      id: "c1",
      label: "Chain is new/clean and fully seated on the sprockets",
      howToVerify: "Look at the chainring and rear cassette.",
      required: true,
      weight: 0.35,
      phase: "after" as const,
      source: "llm" as const,
    },
    {
      id: "cL",
      label: "Liveness code 4821 visible in at least one after photo",
      howToVerify: "Read the four digits written on paper.",
      required: true,
      weight: 0,
      phase: "after" as const,
      source: "system" as const,
    },
  ],
  payment: {
    orderId: "MOCK-ORDER-1",
    authorizationId: "MOCK-AUTH-1",
    authorizationStatus: "CREATED",
    authorized: { currency: "USD", value: "60.00" },
    captured: { currency: "USD", value: "0.00" },
    refunded: { currency: "USD", value: "0.00" },
    captureIds: [],
  },
  events: [
    {
      id: 1,
      type: "STATUS_CHANGED",
      fromStatus: "CREATED",
      toStatus: "AUTHORIZED",
      actor: "customer",
      data: {},
      createdAt: "2026-11-10T12:00:00.000Z",
    },
  ],
  createdAt: "2026-11-10T12:00:00.000Z",
  updatedAt: "2026-11-10T12:00:00.000Z",
};

describe("MoneySchema", () => {
  it("accepts decimal strings with a 3-letter currency", () => {
    expect(MoneySchema.parse({ currency: "USD", value: "120.00" })).toEqual({
      currency: "USD",
      value: "120.00",
    });
  });

  it("rejects bad amounts and currencies", () => {
    expect(MoneySchema.safeParse({ currency: "USD", value: "12.345" }).success).toBe(false);
    expect(MoneySchema.safeParse({ currency: "usd", value: "12.00" }).success).toBe(false);
    expect(MoneySchema.safeParse({ currency: "USD", value: 12 }).success).toBe(false);
  });
});

describe("JobSchema", () => {
  it("parses a fully populated job", () => {
    const parsed = JobSchema.parse(job);
    expect(parsed.criteria).toHaveLength(2);
    expect(parsed.payment?.authorizationId).toBe("MOCK-AUTH-1");
    expect(parsed.livenessCode).toBe("4821");
  });

  it("requires the core fields", () => {
    const withoutCriteria = Object.fromEntries(
      Object.entries(job).filter(([key]) => key !== "criteria"),
    );
    expect(JobSchema.safeParse(withoutCriteria).success).toBe(false);
  });
});

describe("CreateJobBodySchema", () => {
  it("parses a minimal create body and strips unknown keys", () => {
    const parsed = CreateJobBodySchema.parse({
      title: "Replace bike chain",
      description: "Swap the worn chain for a new one.",
      category: "bike_repair",
      amount: { currency: "USD", value: "60.00" },
      extra: "ignored",
    });
    expect(parsed.amount.value).toBe("60.00");
    expect("extra" in parsed).toBe(false);
  });

  it("rejects zero amounts", () => {
    const result = CreateJobBodySchema.safeParse({
      title: "Replace bike chain",
      description: "Swap the worn chain for a new one.",
      category: "bike_repair",
      amount: { currency: "USD", value: "0.00" },
    });
    expect(result.success).toBe(false);
  });
});

describe("ReviewBodySchema", () => {
  it("requires an amount for PARTIAL", () => {
    expect(ReviewBodySchema.safeParse({ decision: "PARTIAL" }).success).toBe(false);
    const ok = ReviewBodySchema.parse({
      decision: "PARTIAL",
      amount: { currency: "USD", value: "96.00" },
    });
    expect(ok.notes).toBe("");
  });

  it("accepts APPROVE and REJECT without an amount", () => {
    expect(ReviewBodySchema.safeParse({ decision: "APPROVE", notes: "looks good" }).success).toBe(true);
    expect(ReviewBodySchema.safeParse({ decision: "REJECT" }).success).toBe(true);
  });
});

describe("DecisionSchema", () => {
  it("round-trips a partial decision", () => {
    const parsed = DecisionSchema.parse({
      outcome: "PARTIAL",
      score: 0.8,
      captureAmount: { currency: "USD", value: "96.00" },
      reasons: ["c4 FAIL (conf 0.88)"],
    });
    expect(parsed.outcome).toBe("PARTIAL");
    expect(parsed.captureAmount?.value).toBe("96.00");
  });
});

describe("VerificationReportSchema", () => {
  it("parses a report with boxes and liveness", () => {
    const parsed = VerificationReportSchema.parse({
      verdicts: [
        {
          criterionId: "c1",
          verdict: "PASS",
          confidence: 0.95,
          rationale: "Chain is clearly new.",
          evidence: [{ imageId: "A1", box_2d: [100, 100, 300, 500], note: "chain" }],
        },
      ],
      sameScene: { verdict: "SAME", confidence: 0.9, rationale: "Same bike frame." },
      livenessCode: { found: true, readValue: "4821", imageId: "A1" },
      imageQualityIssues: ["NONE"],
      summary: "Chain has been replaced.",
    });
    expect(parsed.verdicts[0].verdict).toBe("PASS");
    expect(parsed.livenessCode.readValue).toBe("4821");
  });
});

describe("ApiErrorSchema", () => {
  it("matches the documented error envelope", () => {
    const parsed = ApiErrorSchema.parse({
      error: { code: "ILLEGAL_TRANSITION", message: "Cannot go CREATED -> CAPTURED" },
    });
    expect(parsed.error.code).toBe("ILLEGAL_TRANSITION");
  });
});
