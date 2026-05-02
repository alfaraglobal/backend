import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isEmail } from 'validator';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight, checkPreviewKey } from '../lib/cors';
import { checkoutLimiter, checkRateLimit } from '../lib/ratelimit';
import { stripe, getActiveSubscription, getPriceId, toStripeLocale, VALID_PLANS, VALID_BILLINGS, type Plan, type Billing, type MarketingConsent } from '../lib/stripe';
import { VALID_LANGS, SITE_URL, type Lang } from '../lib/config';
import { normalizePhone } from '../lib/validation';
import { devLog } from '../lib/logger';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = checkOrigin(req);
  if (!origin) return forbidden(res);

  if (handlePreflight(req, res, origin)) return;

  if (!checkPreviewKey(req, res)) return;

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

  let phone: string | undefined;
  if (plan === 'standard' && req.body?.phone !== undefined) {
    if (typeof req.body.phone !== 'string') return res.status(400).json({ error: 'invalid-phone' });
    const normalized = normalizePhone(req.body.phone);
    if (normalized === null) return res.status(400).json({ error: 'invalid-phone' });
    phone = normalized;
  }

  const rawLang = req.body?.lang;
  const lang: Lang = VALID_LANGS.includes(rawLang) ? rawLang : 'en';

  if (req.body?.consent !== true) return res.status(400).json({ error: 'consent-required' });

  if (typeof req.body?.marketing_consent !== 'boolean') return res.status(400).json({ error: 'invalid-marketing-consent' });
  const marketing_consent: MarketingConsent = req.body.marketing_consent ? 'true' : 'false';

  devLog('create-checkout-session: email:', email, 'plan:', plan, 'billing:', billing, 'lang:', lang);

  try {
    const existing = await getActiveSubscription(email);
    devLog('create-checkout-session: existing subscription:', existing != null);
    if (existing) return res.status(200).json({ ok: false, error: 'already-subscribed' });

    const customers = await stripe.customers.list({ email, limit: 1 });
    const phoneField = phone ? { phone } : {};
    const customer = customers.data.length > 0
      ? await stripe.customers.update(customers.data[0].id, { ...phoneField })
      : await stripe.customers.create({ email, ...phoneField });
    devLog('create-checkout-session: customer id:', customer.id);

    const contactMetadata = { language: lang, marketing_consent, ...(phone ? { phone } : {}) };
    const langPrefix = lang === 'en' ? '' : `/${lang}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      customer_update: { address: 'auto', name: 'auto' },
      locale: toStripeLocale(lang),
      line_items: [{ price: getPriceId(plan, billing), quantity: 1 }],
      metadata: contactMetadata,
      subscription_data: {
        metadata: contactMetadata,
      },
      consent_collection: { terms_of_service: 'required' },
      automatic_tax: { enabled: true },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,  // 30 minutes, the minimum allowed by Stripe
      success_url: `${SITE_URL}${langPrefix}/status?type=subscription-success`,
      cancel_url: `${SITE_URL}${langPrefix}/community/checkout-${plan}?billing=${billing}`,
    });

    devLog('create-checkout-session: session created:', session.url);
    return res.status(200).json({ ok: true, url: session.url });
  } catch (err) {
    console.error('[create-checkout-session] error:', err);
    return res.status(500).json({ error: 'server-error' });
  }
}
