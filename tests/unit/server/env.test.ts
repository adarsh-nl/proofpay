import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "@/server/env";

const base = { PAYPAL_MOCK: "1", VISION_MOCK: "1" };

function problems(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
  return [];
}

describe("parseEnv", () => {
  it("applies defaults in full mock mode", () => {
    const env = parseEnv(base);
    expect(env.PAYPAL_ENV).toBe("sandbox");
    expect(env.PAYPAL_API_BASE).toBe("https://api-m.sandbox.paypal.com");
    expect(env.CURRENCY).toBe("USD");
    expect(env.PAYPAL_MOCK).toBe(true);
    expect(env.VISION_MOCK).toBe(true);
    expect(env.AUTO_CAPTURE_ON_APPROVE).toBe(true);
    expect(env.VLM_TIMEOUT_MS).toBe(45000);
    expect(env.T_PASS).toBe(0.9);
    expect(env.PARTIAL_ROUND_TO).toBe(0.05);
    expect(env.REVIEWER_PASSCODE).toBeUndefined();
  });

  it("treats empty strings as unset", () => {
    const env = parseEnv({ ...base, REVIEWER_PASSCODE: "", T_PASS: "", SEED_ON_BOOT: "" });
    expect(env.REVIEWER_PASSCODE).toBeUndefined();
    expect(env.T_PASS).toBe(0.9);
    expect(env.SEED_ON_BOOT).toBe(false);
  });

  it.each([
    "https://api-m.paypal.com",
    "https://api.paypal.com",
    "http://api-m.sandbox.paypal.com",
    "https://api-m.sandbox.paypal.com.evil.example",
    "not a url",
  ])("refuses PAYPAL_API_BASE=%s", (value) => {
    expect(problems({ ...base, PAYPAL_API_BASE: value }).join("\n")).toContain("sandbox only");
  });

  it("refuses PAYPAL_ENV=live", () => {
    expect(problems({ ...base, PAYPAL_ENV: "live" }).join("\n")).toContain("PAYPAL_ENV");
  });

  it("requires PayPal credentials unless PAYPAL_MOCK=1", () => {
    const found = problems({ VISION_MOCK: "1", PAYPAL_MOCK: "0" });
    expect(found.some((p) => p.startsWith("PAYPAL_CLIENT_ID"))).toBe(true);
    expect(found.some((p) => p.startsWith("PAYPAL_CLIENT_SECRET"))).toBe(true);
    expect(() =>
      parseEnv({ VISION_MOCK: "1", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s3cr3t" }),
    ).not.toThrow();
  });

  it("requires an AI key and real model ids when VISION_MOCK=0", () => {
    const found = problems({ PAYPAL_MOCK: "1", VISION_MOCK: "0", LLM_MODEL: "<model-id>" });
    expect(found.some((p) => p.startsWith("GOOGLE_GENERATIVE_AI_API_KEY"))).toBe(true);
    expect(found.some((p) => p.startsWith("LLM_MODEL"))).toBe(true);
    expect(found.some((p) => p.startsWith("VLM_MODEL"))).toBe(true);
    expect(() =>
      parseEnv({
        PAYPAL_MOCK: "1",
        VISION_MOCK: "0",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "k",
        LLM_MODEL: "m",
        VLM_MODEL: "m",
      }),
    ).not.toThrow();
  });

  it("never echoes values in error messages", () => {
    const found = problems({ ...base, PAYPAL_ENV: "live-value-xyz", T_PASS: "7" });
    expect(found.join("\n")).not.toContain("live-value-xyz");
  });
});
