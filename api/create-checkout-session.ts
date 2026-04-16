import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isEmail } from 'validator';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight } from '../lib/cors';
import { checkoutLimiter, checkRateLimit } from '../lib/ratelimit';
import { stripe, getActiveSubscription, getPriceId, toStripeLocale, VALID_PLANS, VALID_BILLINGS, type Plan, type Billing } from '../lib/stripe';
import { VALID_LANGS, SITE_URL, type Lang } from '../lib/config';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = checkOrigin(req);
  if (!origin) return forbidden(res);

  if (handlePreflight(req, res, origin)) return;

  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  if (!await checkRateLimit(checkoutLimiter, req, res)) return;

  setCorsHeaders(res, origin);

  const rawEmail = req.body?.email;
  if (typeof rawEmail !== 'string') return res.status(400).json({ error: 'invalid-email' });

  const email = rawEmail.trim().toLowerCase();
  if (email.length > 254 || !isEmail(email)) return res.status(400).json({ error: 'invalid-email' });

  const plan: Plan | undefined = VALID_PLANS.includes(req.body?.plan) ? req.body.plan : undefined;
  if (!plan) return res.status(400).json({ error: 'invalid-plan' });

  const billing: Billing | undefined = VALID_BILLINGS.includes(req.body?.billing) ? req.body.billing : undefined;
  if (!billing) return res.status(400).json({ error: 'invalid-billing' });

  const rawLang = req.body?.lang;
  const lang: Lang = VALID_LANGS.includes(rawLang) ? rawLang : 'en';

  try {
    const existing = await getActiveSubscription(email);
    if (existing) return res.status(200).json({ ok: false, error: 'already-subscribed' });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      locale: toStripeLocale(lang),
      line_items: [{ price: getPriceId(plan, billing), quantity: 1 }],
      subscription_data: {
        metadata: { language: lang },
      },
      automatic_tax: { enabled: true },
      success_url: `${SITE_URL}/status?type=subscription-success`,
      cancel_url: `${SITE_URL}/community`,
    });

    return res.status(200).json({ ok: true, url: session.url });
  } catch (err) {
    console.error('[create-checkout-session] error:', err);
    return res.status(500).json({ error: 'server-error' });
  }
}
