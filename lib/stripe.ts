import Stripe from 'stripe';
import type { Lang } from './config';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  timeout: Number(process.env.STRIPE_TIMEOUT_MS ?? 5000),
});

export function toStripeLocale(lang: Lang) {
  return lang === 'ca' ? 'es' : lang;
}

export const STRIPE_BASIC_PRODUCT_ID = process.env.STRIPE_BASIC_PRODUCT_ID!;
export const STRIPE_STANDARD_PRODUCT_ID = process.env.STRIPE_STANDARD_PRODUCT_ID!;
export const STRIPE_PREMIUM_PRODUCT_ID = process.env.STRIPE_PREMIUM_PRODUCT_ID!;
export const STRIPE_PORTAL_CONFIG_DEFAULT = process.env.STRIPE_PORTAL_CONFIG_DEFAULT!;
export const STRIPE_PORTAL_CONFIG_PREMIUM = process.env.STRIPE_PORTAL_CONFIG_PREMIUM!;

export type SubscriptionPlan = Plan | 'premium';

export function getPlanFromProductId(productId: string): SubscriptionPlan | null {
  if (productId === STRIPE_BASIC_PRODUCT_ID) return 'basic';
  if (productId === STRIPE_STANDARD_PRODUCT_ID) return 'standard';
  if (productId === STRIPE_PREMIUM_PRODUCT_ID) return 'premium';
  return null;
}

export const VALID_PLANS = ['basic', 'standard'] as const;
export type Plan = typeof VALID_PLANS[number];

export const PAYMENT_STATUSES = ['active', 'failing', 'canceled'] as const;
export type PaymentStatus = typeof PAYMENT_STATUSES[number];

export type WhatsappStatus = 'false' | 'true' | '';
export type WhatsappRemoval = 'true' | 'false';

export const VALID_BILLINGS = ['monthly', 'yearly'] as const;
export type Billing = typeof VALID_BILLINGS[number];

const PRICE_IDS: Record<Plan, Record<Billing, string>> = {
  basic: {
    monthly: process.env.STRIPE_BASIC_MONTHLY_PRICE_ID!,
    yearly: process.env.STRIPE_BASIC_YEARLY_PRICE_ID!,
  },
  standard: {
    monthly: process.env.STRIPE_STANDARD_MONTHLY_PRICE_ID!,
    yearly: process.env.STRIPE_STANDARD_YEARLY_PRICE_ID!,
  },
};

export const PREMIUM_PRICE_IDS: Record<Billing, string> = {
  monthly: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID!,
  yearly: process.env.STRIPE_PREMIUM_YEARLY_PRICE_ID!,
};

export function getPriceId(plan: Plan, billing: Billing): string {
  return PRICE_IDS[plan][billing];
}

/**
 * Returns the active subscription for a given email, or null if none exists.
 * Use this before creating a checkout session to prevent duplicate subscriptions.
 */
export async function getActiveSubscription(email: string) {
  const customers = await stripe.customers.list({ email, limit: 1 });
  if (customers.data.length === 0) return null;

  const subscriptions = await stripe.subscriptions.list({
    customer: customers.data[0].id,
    status: 'active',
    limit: 1,
  });

  return subscriptions.data[0] ?? null;
}
