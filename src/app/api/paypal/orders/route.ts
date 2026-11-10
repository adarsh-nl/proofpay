import { NextResponse } from "next/server";
import { CreateOrderBodySchema } from "@/shared/contracts";
import { requireRole } from "@/server/http/role";
import { readJson, withErrors } from "@/server/http/with-errors";
import { createOrder } from "@/server/paypal/orders";

/** MANUAL §8 #5: create a PayPal order (`intent: "AUTHORIZE"`) for a job. */
export const POST = withErrors(async (req) => {
  requireRole(req, "customer");
  const { jobId } = CreateOrderBodySchema.parse(await readJson(req));
  const { orderId } = await createOrder(jobId);
  return NextResponse.json({ orderId }, { status: 201 });
});
