import type { VercelRequest, VercelResponse } from '@vercel/node';
import { stripe, getActiveSubscription, toStripeLocale, PREMIUM_PRICE_IDS, VALID_BILLINGS, type Billing } from '../lib/stripe';
import { confirmLimiter, checkRateLimit, redis } from '../lib/ratelimit';
import { SITE_URL, type Lang } from '../lib/config';

interface PremiumTokenPayload {
  email: string;
  name: string;
  lang: Lang;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end('Method Not Allowed');

  if (!await checkRateLimit(confirmLimiter, req, res)) return;

  const token = typeof req.query.token === 'string' ? req.query.token : null;
  const billing = typeof req.query.billing === 'string' && VALID_BILLINGS.includes(req.query.billing as Billing)
    ? req.query.billing as Billing
    : null;

  if (!token || !billing) return res.redirect(`${SITE_URL}/status?type=500`);

  try {
    const payload = await redis.get<PremiumTokenPayload>(`premium_token:${token}`);
    if (!payload) return res.redirect(`${SITE_URL}/status?type=500`);

    await redis.del(`premium_token:${token}`);

    const existing = await getActiveSubscription(payload.email);
    if (existing) return res.redirect(`${SITE_URL}/status?type=500`);

    const customers = await stripe.customers.list({ email: payload.email, limit: 1 });
    const customer = customers.data.length > 0
      ? await stripe.customers.update(customers.data[0].id, { name: payload.name })
      : await stripe.customers.create({ email: payload.email, name: payload.name });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      customer_update: { address: 'auto' },
      locale: toStripeLocale(payload.lang),
      line_items: [{ price: PREMIUM_PRICE_IDS[billing], quantity: 1 }],
      subscription_data: {
        metadata: { language: payload.lang },
      },
      automatic_tax: { enabled: true },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      success_url: `${SITE_URL}/status?type=subscription-success`,
      cancel_url: SITE_URL,
    });

    return res.redirect(session.url!);
  } catch (err) {
    console.error('[redeem-premium-session] error:', err);
    return res.redirect(`${SITE_URL}/status?type=500`);
  }
}
