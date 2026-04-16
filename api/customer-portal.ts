import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isEmail } from 'validator';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight } from '../lib/cors';
import { portalLimiter, checkRateLimit } from '../lib/ratelimit';
import { stripe, getActiveSubscription, toStripeLocale, STRIPE_PREMIUM_PRODUCT_ID, STRIPE_PORTAL_CONFIG_DEFAULT, STRIPE_PORTAL_CONFIG_PREMIUM } from '../lib/stripe';
import { VALID_LANGS, SITE_URL, type Lang } from '../lib/config';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = checkOrigin(req);
  if (!origin) return forbidden(res);

  if (handlePreflight(req, res, origin)) return;

  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  if (!await checkRateLimit(portalLimiter, req, res)) return;

  setCorsHeaders(res, origin);

  const raw = req.body?.email;
  if (typeof raw !== 'string') return res.status(400).json({ error: 'invalid-email' });

  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !isEmail(email)) return res.status(400).json({ error: 'invalid-email' });

  const rawLang = req.body?.lang;
  const lang: Lang = VALID_LANGS.includes(rawLang) ? rawLang : 'en';

  try {
    const subscription = await getActiveSubscription(email);

    if (!subscription) return res.status(200).json({ ok: true });

    const productId = subscription.items.data[0]?.price.product;
    const hasPremium = productId === STRIPE_PREMIUM_PRODUCT_ID;
    const configuration = hasPremium ? STRIPE_PORTAL_CONFIG_PREMIUM : STRIPE_PORTAL_CONFIG_DEFAULT;

    const customer = subscription.customer as string;

    const session = await stripe.billingPortal.sessions.create({
      customer,
      configuration,
      return_url: SITE_URL,
      locale: toStripeLocale(lang),
    });

    return res.status(200).json({ ok: true, url: session.url });
  } catch (err) {
    console.error('[customer-portal] error:', err);
    return res.status(500).json({ error: 'server-error' });
  }
}
