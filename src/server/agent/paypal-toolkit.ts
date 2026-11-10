import "server-only";
import { z } from "zod";
import { getEnv } from "@/server/env";
import { ppFetch } from "@/server/paypal/client";

/**
 * Read-only PayPal Agent Toolkit access (`@paypal/agent-toolkit/ai-sdk`).
 * Only `orders.get`, `disputes.list` and `disputes.get` are enabled. The
 * toolkit has no void or partial-capture tool; money moves only through
 * `src/server/escrow/settle.ts` behind `policy.ts`.
 *
 * The toolkit defaults to the live API, so `context.sandbox` is always true.
 * With `PAYPAL_MOCK=1` the toolkit is not loaded and the mock order is read.
 */

export type ToolkitToolName = "get_order" | "list_disputes" | "get_dispute";
type ToolkitTool = { description?: string; execute?: (args: never, options: never) => unknown };

let toolsPromise: Promise<Record<string, ToolkitTool>> | undefined;

async function loadTools(): Promise<Record<string, ToolkitTool>> {
  const env = getEnv();
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal credentials are not configured");
  }
  const { PayPalAgentToolkit } = await import("@paypal/agent-toolkit/ai-sdk");
  const toolkit = new PayPalAgentToolkit({
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    configuration: {
      actions: { orders: { get: true }, disputes: { list: true, get: true } },
      context: { sandbox: true },
    },
  });
  return toolkit.getTools() as unknown as Record<string, ToolkitTool>;
}

/** Run one enabled toolkit tool and return its parsed result. */
export async function callToolkit(name: ToolkitToolName, args: Record<string, unknown>): Promise<unknown> {
  toolsPromise ??= loadTools();
  const tools = await toolsPromise;
  const execute = tools[name]?.execute as
    | ((args: Record<string, unknown>, options: Record<string, unknown>) => unknown)
    | undefined;
  if (!execute) throw new Error(`PayPal Agent Toolkit tool ${name} is not available`);
  const result = await execute(args, { toolCallId: `proofpay-${name}`, messages: [] });
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result) as unknown;
  } catch {
    return result;
  }
}

const OrderStateSchema = z.object({ id: z.string().optional(), status: z.string().optional() });
export type OrderState = { status: string; source: "paypal-agent-toolkit" | "mock" | "unavailable" };

/** Order status for the evidence pack, via the toolkit's `get_order` (mock order in mock mode). */
export async function getOrderState(orderId: string): Promise<OrderState> {
  try {
    if (getEnv().PAYPAL_MOCK) {
      const order = await ppFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
        schema: OrderStateSchema,
      });
      return { status: order.status ?? "UNKNOWN", source: "mock" };
    }
    const parsed = OrderStateSchema.safeParse(await callToolkit("get_order", { id: orderId }));
    if (parsed.success && parsed.data.status) {
      return { status: parsed.data.status, source: "paypal-agent-toolkit" };
    }
  } catch (error) {
    console.warn(
      `[agent] get_order failed for ${orderId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { status: "UNAVAILABLE", source: "unavailable" };
}
