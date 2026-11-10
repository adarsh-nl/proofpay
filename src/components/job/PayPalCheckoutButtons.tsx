'use client';

import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js';

import { api, ApiClientError } from '@/lib/api-client';
import type { Job } from '@/shared/contracts';

export interface PayPalCheckoutButtonsProps {
  jobId: string;
  onAuthorized: (job: Job) => void;
  onError: (message: string) => void;
}

/**
 * Real PayPal Orders v2 checkout (intent=AUTHORIZE, MANUAL §10.3):
 * createOrder → POST /api/paypal/orders, onApprove → POST /api/paypal/orders/:id/authorize.
 * Only rendered when `NEXT_PUBLIC_PAYPAL_MOCK !== '1'` and a client id is configured.
 */
export function PayPalCheckoutButtons({ jobId, onAuthorized, onError }: PayPalCheckoutButtonsProps) {
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? '';

  if (!clientId) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        PayPal is not configured: set `NEXT_PUBLIC_PAYPAL_CLIENT_ID` in `.env.local`, or run the demo
        in mock mode with `NEXT_PUBLIC_PAYPAL_MOCK=1`.
      </p>
    );
  }

  return (
    <div data-testid="paypal-buttons">
      <PayPalScriptProvider
        options={{
          clientId,
          intent: 'authorize',
          currency: 'USD',
          components: 'buttons',
        }}
      >
        <PayPalButtons
          style={{ layout: 'vertical', shape: 'rect', label: 'paypal', height: 44 }}
          forceReRender={[jobId]}
          createOrder={async () => {
            try {
              const response = await api.createOrder({ jobId });
              return response.orderId;
            } catch (cause) {
              const message =
                cause instanceof ApiClientError
                  ? cause.message
                  : 'Could not create the PayPal order.';
              onError(message);
              throw cause;
            }
          }}
          onApprove={async (data) => {
            try {
              const job = await api.authorize(data.orderID, { jobId });
              onAuthorized(job);
            } catch (cause) {
              const message =
                cause instanceof ApiClientError
                  ? cause.message
                  : 'PayPal approved, but authorization failed.';
              onError(message);
            }
          }}
          onError={(cause) => {
            onError(
              cause instanceof Error
                ? `PayPal checkout error: ${cause.message}`
                : 'PayPal checkout error.',
            );
          }}
          onCancel={() => onError('PayPal checkout cancelled — no money moved.')}
        />
      </PayPalScriptProvider>
    </div>
  );
}
