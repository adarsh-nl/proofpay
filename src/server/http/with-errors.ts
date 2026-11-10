import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { ApiError } from "@/shared/contracts";
import { IllegalTransition } from "@/server/escrow/machine";
import { EnvError } from "@/server/env";
import { PayPalError, PayPalNetworkError } from "@/server/paypal/errors";
import { HttpError } from "./errors";

export type RouteContext<P> = { params: Promise<P> };
export type RouteHandler<P> = (req: Request, ctx: RouteContext<P>) => Promise<Response> | Response;

function errorResponse(status: number, code: string, message: string, details?: unknown) {
  const body: ApiError = { error: { code, message, ...(details === undefined ? {} : { details }) } };
  return NextResponse.json(body, { status });
}

/** Map any thrown value to the `{ error: { code, message, details? } }` contract (MANUAL §13). */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "Invalid request",
      error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  if (error instanceof IllegalTransition) {
    return errorResponse(409, "ILLEGAL_TRANSITION", error.message, {
      from: error.from,
      to: error.to,
    });
  }
  if (error instanceof HttpError) {
    return errorResponse(error.status, error.code, error.message, error.details);
  }
  if (error instanceof PayPalError) {
    return errorResponse(502, error.issue, error.message, {
      debugId: error.debugId,
      paypalStatus: error.status,
    });
  }
  if (error instanceof PayPalNetworkError) {
    return errorResponse(502, "PAYPAL_UNREACHABLE", "PayPal could not be reached. Try again.");
  }
  if (error instanceof EnvError) {
    console.error(`[http] ${error.message}`);
    return errorResponse(500, "SERVER_MISCONFIGURED", "The server is not configured correctly.");
  }
  console.error("[http] unhandled error", error);
  return errorResponse(500, "INTERNAL_ERROR", "Something went wrong.");
}

/** Wrap a route handler so every failure becomes a typed JSON error. */
export function withErrors<P = Record<string, never>>(handler: RouteHandler<P>) {
  return async (req: Request, ctx: RouteContext<P>): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

/** JSON bodies are small (the largest is a 12-item checklist); anything bigger is refused. */
export const MAX_JSON_BYTES = 100 * 1024;

/** Refuse a request whose declared `Content-Length` is above `maxBytes` (413). */
export function assertContentLength(req: Request, maxBytes: number): void {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  }
}

/** Parse a JSON body; an empty body is `{}`, malformed JSON is a 400, an oversized body a 413. */
export async function readJson(req: Request): Promise<unknown> {
  assertContentLength(req, MAX_JSON_BYTES);
  const text = await req.text();
  if (text.length > MAX_JSON_BYTES) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}
