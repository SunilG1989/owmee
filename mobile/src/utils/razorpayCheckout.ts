import RazorpayCheckout from 'react-native-razorpay';

import type { CheckoutPaymentFailure, CheckoutPaymentSuccess, PaymentCheckout } from '../services/api';
import { C } from './tokens';

type RazorpayResult = {
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
};

export function canOpenRazorpayCheckout(checkout?: PaymentCheckout | null): checkout is PaymentCheckout {
  return Boolean(
    checkout?.provider === 'razorpay' &&
    checkout.key_id &&
    checkout.order_id &&
    Number(checkout.amount_paise) > 0 &&
    !isPaymentCheckoutExpired(checkout),
  );
}

export function secondsUntilPaymentExpiry(expiresAt?: string | null): number | null {
  if (!expiresAt) return null;
  const expiryMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiryMs)) return null;
  return Math.floor((expiryMs - Date.now()) / 1000);
}

export function isPaymentCheckoutExpired(checkout?: PaymentCheckout | null): boolean {
  const remaining = secondsUntilPaymentExpiry(checkout?.expires_at);
  return remaining !== null && remaining <= 0;
}

export function isPaymentWindowExpired(expiresAt?: string | null): boolean {
  const remaining = secondsUntilPaymentExpiry(expiresAt);
  return remaining !== null && remaining <= 0;
}

export async function openRazorpayCheckout(
  checkout: PaymentCheckout,
): Promise<CheckoutPaymentSuccess> {
  if (!canOpenRazorpayCheckout(checkout)) {
    throw new Error(isPaymentCheckoutExpired(checkout)
      ? 'RAZORPAY_CHECKOUT_EXPIRED'
      : 'RAZORPAY_CHECKOUT_NOT_CONFIGURED');
  }
  const remaining = secondsUntilPaymentExpiry(checkout.expires_at);
  const configuredTimeout = Number(checkout.checkout_timeout_seconds || 900);
  const safeConfiguredTimeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : 900;
  const timeout = Math.max(1, Math.min(safeConfiguredTimeout, remaining ?? 900));

  const result = await RazorpayCheckout.open({
    key: checkout.key_id,
    amount: String(checkout.amount_paise),
    currency: checkout.currency || 'INR',
    name: checkout.name || 'Owmee',
    description: checkout.description || 'Owmee order',
    order_id: checkout.order_id,
    prefill: {
      contact: checkout.prefill?.contact || '',
      email: checkout.prefill?.email || '',
      name: checkout.prefill?.name || '',
    },
    timeout,
    retry: { enabled: true, max_count: 3 },
    theme: { color: C.petrol },
  }) as RazorpayResult;

  if (!result.razorpay_payment_id || !result.razorpay_signature) {
    throw new Error('RAZORPAY_CHECKOUT_INCOMPLETE');
  }

  return {
    razorpay_order_id: checkout.order_id,
    razorpay_payment_id: result.razorpay_payment_id,
    razorpay_signature: result.razorpay_signature,
  };
}

export function isUserCancelledRazorpay(error: unknown): boolean {
  const anyError = error as { code?: unknown; description?: unknown };
  const code = String(anyError?.code || '').toUpperCase();
  const description = String(anyError?.description || '').toLowerCase();
  return code.includes('CANCEL') || description.includes('cancel');
}

export function isRazorpayCheckoutExpiredError(error: unknown): boolean {
  return String((error as Error | undefined)?.message || error || '').includes('RAZORPAY_CHECKOUT_EXPIRED');
}

export function razorpayFailureFromError(
  checkout: PaymentCheckout,
  error: unknown,
): CheckoutPaymentFailure {
  const anyError = error as {
    code?: unknown;
    description?: unknown;
    error?: {
      code?: unknown;
      description?: unknown;
      source?: unknown;
      step?: unknown;
      reason?: unknown;
      metadata?: {
        payment_id?: unknown;
        order_id?: unknown;
      };
    };
    metadata?: {
      payment_id?: unknown;
      order_id?: unknown;
    };
  };
  const nested = anyError?.error || {};
  const metadata = nested.metadata || anyError?.metadata || {};
  return {
    razorpay_order_id: String(metadata.order_id || checkout.order_id),
    razorpay_payment_id: metadata.payment_id ? String(metadata.payment_id) : null,
    code: anyError?.code || nested.code ? String(anyError?.code || nested.code) : null,
    description: anyError?.description || nested.description
      ? String(anyError?.description || nested.description)
      : null,
    source: nested.source ? String(nested.source) : null,
    step: nested.step ? String(nested.step) : null,
    reason: nested.reason ? String(nested.reason) : null,
  };
}
