import "server-only";
import { z } from "zod";

/**
 * Zod-validated environment (AGENTS.md §7). Server code reads `process.env`
 * only through `getEnv()`. Validation is lazy so `next build` works without a
 * filled `.env.local`; the first request (or `scripts/start.mjs`) fails loudly
 * with every problem listed.
 */

export const SANDBOX_API_HOST = "api-m.sandbox.paypal.com";

const flag = (defaultOn: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      if (trimmed === undefined || trimmed === "") return defaultOn;
      return trimmed === "1" || trimmed.toLowerCase() === "true";
    });

/** Empty strings in `.env` files mean "not set". */
const optionalString = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

const withDefault = (fallback: string) =>
  optionalString.transform((value) => value ?? fallback);

const ratio = (fallback: number) =>
  optionalString
    .transform((value) => (value === undefined ? fallback : Number(value)))
    .pipe(z.number().min(0).max(1));

const EnvSchema = z
  .object({
    PAYPAL_ENV: withDefault("sandbox").pipe(
      z.literal("sandbox", {
        error: 'PAYPAL_ENV must be "sandbox" (ProofPay refuses live credentials)',
      }),
    ),
    PAYPAL_API_BASE: withDefault(`https://${SANDBOX_API_HOST}`),
    PAYPAL_CLIENT_ID: optionalString,
    PAYPAL_CLIENT_SECRET: optionalString,
    NEXT_PUBLIC_PAYPAL_CLIENT_ID: optionalString,
    PAYPAL_WEBHOOK_ID: optionalString,
    PAYPAL_MOCK: flag(false),
    NEXT_PUBLIC_PAYPAL_MOCK: flag(false),
    PAYOUTS_ENABLED: flag(false),
    /** Stretch T18: worker payout receiver (PayPal sandbox account email). */
    WORKER_SANDBOX_EMAIL: optionalString,
    CURRENCY: withDefault("USD").pipe(z.string().regex(/^[A-Z]{3}$/)),

    AI_PROVIDER: withDefault("google").pipe(z.enum(["google", "openai"])),
    GOOGLE_GENERATIVE_AI_API_KEY: optionalString,
    OPENAI_API_KEY: optionalString,
    LLM_MODEL: optionalString,
    VLM_MODEL: optionalString,
    VISION_MOCK: flag(true),
    VLM_TIMEOUT_MS: optionalString
      .transform((value) => (value === undefined ? 45_000 : Number(value)))
      .pipe(z.number().int().positive()),

    T_PASS: ratio(0.9),
    T_PARTIAL: ratio(0.5),
    T_CONF: ratio(0.75),
    T_LOW_CONF: ratio(0.6),
    PARTIAL_ROUND_TO: ratio(0.05).refine((value) => value > 0, {
      message: "PARTIAL_ROUND_TO must be greater than 0",
    }),
    AUTO_CAPTURE_ON_APPROVE: flag(true),

    APP_BASE_URL: withDefault("http://localhost:3000"),
    DATABASE_PATH: withDefault("./data/proofpay.db"),
    UPLOAD_DIR: withDefault("./data/uploads"),
    SEED_ON_BOOT: flag(false),
    DEMO_RESET_ENABLED: flag(false),
    REVIEWER_PASSCODE: optionalString,
  })
  .superRefine((env, ctx) => {
    let host: string | undefined;
    let protocol: string | undefined;
    try {
      const url = new URL(env.PAYPAL_API_BASE);
      host = url.host;
      protocol = url.protocol;
    } catch {
      // handled below
    }
    if (host !== SANDBOX_API_HOST || protocol !== "https:") {
      ctx.addIssue({
        code: "custom",
        path: ["PAYPAL_API_BASE"],
        message: `PAYPAL_API_BASE must be https://${SANDBOX_API_HOST} (sandbox only)`,
      });
    }
    if (!env.PAYPAL_MOCK) {
      for (const key of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required unless PAYPAL_MOCK=1`,
          });
        }
      }
    }
    if (!env.VISION_MOCK) {
      const key =
        env.AI_PROVIDER === "google"
          ? "GOOGLE_GENERATIVE_AI_API_KEY"
          : "OPENAI_API_KEY";
      if (!env[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when VISION_MOCK=0 and AI_PROVIDER=${env.AI_PROVIDER}`,
        });
      }
      for (const model of ["LLM_MODEL", "VLM_MODEL"] as const) {
        if (!env[model] || env[model].startsWith("<")) {
          ctx.addIssue({
            code: "custom",
            path: [model],
            message: `${model} must be a real model id when VISION_MOCK=0`,
          });
        }
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Invalid environment (see .env.example):\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    this.name = "EnvError";
  }
}

/** Pure parser; never includes values in error messages. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map(
        (issue) => `${issue.path.join(".") || "env"}: ${issue.message}`,
      ),
    );
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Tests only: re-read `process.env` on the next `getEnv()`. */
export function resetEnvCache(): void {
  cached = undefined;
}

export type Thresholds = {
  tPass: number;
  tPartial: number;
  tConf: number;
  tLowConf: number;
  partialRoundTo: number;
};

/** Decision-engine thresholds (docs/MANUAL.md §9.4). */
export function getThresholds(): Thresholds {
  const env = getEnv();
  return {
    tPass: env.T_PASS,
    tPartial: env.T_PARTIAL,
    tConf: env.T_CONF,
    tLowConf: env.T_LOW_CONF,
    partialRoundTo: env.PARTIAL_ROUND_TO,
  };
}
