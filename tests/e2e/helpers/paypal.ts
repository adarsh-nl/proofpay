/**
 * All interactions with the real PayPal sandbox popup live here, so selector changes are
 * a one-file fix.
 *
 * IMPORTANT: LIVE-VERIFY. The selection below is the documented shape of the sandbox
 * checkout in the PayPal sandbox, but it can only be verified with a real sandbox buyer
 * (E2E_BUYER_EMAIL / E2E_BUYER_PASSWORD) and a server running with
 * NEXT_PUBLIC_PAYPAL_MOCK=0. The offline mock happy path does not touch this file.
 */
import { expect, type Page } from '@playwright/test';

export type PaypalBuyerCredentials = { email: string; password: string };

/** Credentials from the environment, or null when the @live test must be skipped. */
export function liveBuyerCredentials(): PaypalBuyerCredentials | null {
  const email = process.env.E2E_BUYER_EMAIL?.trim();
  const password = process.env.E2E_BUYER_PASSWORD?.trim();
  if (!email || !password) return null;
  return { email, password };
}

/**
 * Click the PayPal button inside the smart-button iframe (F03 renders
 * `[data-testid=paypal-buttons]`). The PayPal SDK mounts an iframe; the button inside it
 * has `data-testid="paypal-button"` in the current sandbox SDK.
 */
export async function clickPaypalCheckoutButton(page: Page): Promise<void> {
  const wrapper = page.getByTestId('paypal-buttons');
  await expect(wrapper).toBeVisible({ timeout: 30_000 });
  const frame = wrapper.locator('iframe').first();
  await expect(frame).toBeAttached({ timeout: 30_000 });
  const button = page
    .frameLocator('[data-testid="paypal-buttons"] iframe')
    .locator('[data-testid="paypal-button"], [role="button"]')
    .first();
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();
}

/**
 * Log into the sandbox buyer popup and approve the authorization, then wait for the popup
 * to close. Errors are allowed at the very end: the app closes the popup once approved.
 */
export async function completePaypalSandboxCheckout(
  page: Page,
  credentials: PaypalBuyerCredentials,
): Promise<void> {
  const popup = await page.waitForEvent('popup', { timeout: 60_000 });
  await popup.waitForLoadState('domcontentloaded').catch(() => undefined);

  // Email step.
  const email = popup.locator('#email, input[name="login_email"], input[type="email"]').first();
  await expect(email).toBeVisible({ timeout: 30_000 });
  await email.fill(credentials.email);
  await popup.getByRole('button', { name: /next|continue/i }).first().click();

  // Password step.
  const password = popup.locator('#password, input[name="login_password"], input[type="password"]').first();
  await expect(password).toBeVisible({ timeout: 30_000 });
  await password.fill(credentials.password);
  await popup.getByRole('button', { name: /log ?in|sign ?in|next|continue/i }).first().click();

  // Review / approve step: wording varies between "Agree & Continue", "Complete
  // Purchase", "Pay Now" and "Approve". Try the documented labels in order.
  const approve = popup
    .getByRole('button', { name: /agree ?& ?continue|complete (purchase|payment)|pay now|approve|confirm/i })
    .first();
  await expect(approve).toBeVisible({ timeout: 60_000 });
  await approve.click();

  await popup.waitForEvent('close', { timeout: 60_000 }).catch(() => undefined);
}
