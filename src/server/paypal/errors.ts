import "server-only";

export type PayPalErrorDetail = { issue?: string; description?: string; field?: string };

/**
 * A non-2xx PayPal response. `issue` is the first `details[].issue`
 * (e.g. `MAX_CAPTURE_AMOUNT_EXCEEDED`), falling back to the error `name`.
 */
export class PayPalError extends Error {
  public readonly paypalName: string;
  public readonly description: string | undefined;
  public readonly details: PayPalErrorDetail[];

  constructor(
    public readonly status: number,
    public readonly issue: string,
    public readonly debugId: string | undefined,
    extra: {
      name?: string;
      message?: string;
      description?: string;
      details?: PayPalErrorDetail[];
    } = {},
  ) {
    super(extra.description ?? extra.message ?? `PayPal request failed: ${issue}`);
    this.name = "PayPalError";
    this.paypalName = extra.name ?? issue;
    this.description = extra.description;
    this.details = extra.details ?? [];
  }
}

/** The request never produced a PayPal response (DNS, TLS, timeout, reset). */
export class PayPalNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PayPalNetworkError";
  }
}
