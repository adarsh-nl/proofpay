import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    mockVision: process.env.VISION_MOCK === "1",
    mockPaypal: process.env.PAYPAL_MOCK === "1",
    paypalEnv: "sandbox",
  });
}
