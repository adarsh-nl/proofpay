import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    // Same rule as src/server/env.ts: unset or empty means mock (no AI calls).
    mockVision: ["", "1", "true"].includes((process.env.VISION_MOCK ?? "").trim().toLowerCase()),
    mockPaypal: process.env.PAYPAL_MOCK === "1",
    paypalEnv: "sandbox",
  });
}
