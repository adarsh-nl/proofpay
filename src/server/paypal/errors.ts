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

/**
 * Friendly, user-facing copy for the PayPal 422 issues ProofPay can hit
 * (docs/MANUAL.md §10.3). Keys are PayPal's `details[].issue` values; the
 * mappings are best-effort from the public PayPal spec and are marked
 * "verify" in docs/REFERENCES.md until observed against the sandbox.
 */
export const PAYPAL_ISSUE_MESSAGES: Readonly<Record<string, string>> = {
  AUTHORIZATION_EXPIRED:
    "The PayPal authorization has expired. Ask the customer to authorize the payment again.",
  AUTHORIZATION_VOIDED: "This PayPal authorization was already voided.",
  AUTHORIZATION_ALREADY_CAPTURED:
    "This PayPal authorization has already been captured.",
  MAX_CAPTURE_AMOUNT_EXCEEDED:
    "The capture amount is higher than the amount the customer authorized.",
  DUPLICATE_INVOICE_ID:
    "PayPal already has a capture with this invoice id. The payment was not taken twice.",
  PREVIOUSLY_CAPTURED: "This PayPal authorization has already been captured.",
  PREVIOUSLY_VOIDED: "This PayPal authorization was already voided.",
  CANNOT_BE_VOIDED:
    "PayPal cannot void this authorization because it was already captured.",
  ORDER_NOT_APPROVED:
    "The buyer has not approved this PayPal order yet. Approve it, then authorize.",
  CURRENCY_MISMATCH:
    "The amount currency does not match the currency of the PayPal payment.",
  CAPTURE_FULLY_REFUNDED: "This PayPal capture has already been fully refunded.",
  INSTRUMENT_DECLINED:
    "PayPal declined the funding source. Ask the customer to choose another payment method.",
  RESOURCE_NOT_FOUND: "PayPal could not find that payment resource.",
};

/** Friendly message for a PayPal error, falling back to its description. */
export function friendlyPayPalMessage(
  error: PayPalError,
  fallback = "PayPal could not complete the request. Please try again.",
): string {
  return PAYPAL_ISSUE_MESSAGES[error.issue] ?? error.description ?? fallback;
}
