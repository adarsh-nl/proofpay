import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { IllegalTransition } from "@/server/escrow/machine";
import { ConflictError, NotFoundError, PolicyError, ValidationError } from "@/server/http/errors";
import { getRole, requireRole } from "@/server/http/role";
import { readJson, withErrors } from "@/server/http/with-errors";
import { PayPalError, PayPalNetworkError } from "@/server/paypal/errors";
import { apiRequest, jsonOf, params } from "../../helpers";

type ErrorBody = { error: { code: string; message: string; details?: unknown } };

async function run(thrown: unknown) {
  const handler = withErrors(async () => {
    throw thrown;
  });
  const res = await handler(apiRequest("/x"), params({}));
  return { status: res.status, body: await jsonOf<ErrorBody>(res) };
}

afterEach(() => vi.restoreAllMocks());

describe("withErrors", () => {
  it("passes a successful response through", async () => {
    const handler = withErrors(async () => Response.json({ ok: true }, { status: 201 }));
    const res = await handler(apiRequest("/x"), params({}));
    expect(res.status).toBe(201);
  });

  it("maps ZodError to 400 with the issue paths", async () => {
    const parsed = z.object({ jobId: z.string() }).safeParse({});
    const { status, body } = await run(parsed.error);
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toEqual([expect.objectContaining({ path: "jobId" })]);
  });

  it.each([
    [new ValidationError("bad"), 400, "VALIDATION_ERROR"],
    [new PolicyError("no"), 403, "FORBIDDEN"],
    [new NotFoundError("Job"), 404, "NOT_FOUND"],
    [new ConflictError("busy", "JOB_NOT_PAYABLE"), 409, "JOB_NOT_PAYABLE"],
    [new IllegalTransition("CREATED", "CAPTURED"), 409, "ILLEGAL_TRANSITION"],
  ])("maps %s to its status", async (error, expectedStatus, code) => {
    const { status, body } = await run(error);
    expect(status).toBe(expectedStatus);
    expect(body.error.code).toBe(code);
    expect(body.error.message).toBeTruthy();
  });

  it("maps PayPalError to 502 with the issue as code and the debug id", async () => {
    const { status, body } = await run(
      new PayPalError(422, "MAX_CAPTURE_AMOUNT_EXCEEDED", "dbg-1", { description: "Too much." }),
    );
    expect(status).toBe(502);
    expect(body.error).toEqual({
      code: "MAX_CAPTURE_AMOUNT_EXCEEDED",
      message: "Too much.",
      details: { debugId: "dbg-1", paypalStatus: 422 },
    });
  });

  it("maps a PayPal network failure to 502", async () => {
    const { status, body } = await run(new PayPalNetworkError("down"));
    expect(status).toBe(502);
    expect(body.error.code).toBe("PAYPAL_UNREACHABLE");
  });

  it("maps anything else to 500 without leaking the message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, body } = await run(new Error("db password is hunter2"));
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });
});

describe("readJson", () => {
  it("treats an empty body as {} and rejects malformed JSON", async () => {
    await expect(readJson(new Request("http://x", { method: "POST" }))).resolves.toEqual({});
    await expect(
      readJson(new Request("http://x", { method: "POST", body: "{nope" })),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_JSON" });
  });
});

describe("role cookie", () => {
  it("reads pp_role among other cookies", () => {
    const req = new Request("http://x", { headers: { cookie: "a=1; pp_role=worker; b=2" } });
    expect(getRole(req)).toBe("worker");
    expect(requireRole(req, "customer", "worker")).toBe("worker");
  });

  it("ignores unknown roles and rejects a missing or wrong role with 403", () => {
    expect(getRole(new Request("http://x", { headers: { cookie: "pp_role=admin" } }))).toBeUndefined();
    expect(() => requireRole(new Request("http://x"), "customer")).toThrow(PolicyError);
    expect(() => requireRole(apiRequest("/x", { role: "worker" }), "customer")).toThrow(
      expect.objectContaining({ status: 403, code: "FORBIDDEN_ROLE" }),
    );
  });
});
