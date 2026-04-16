import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isEmail } from 'validator';
import { stripe, getActiveSubscription, toStripeLocale, PREMIUM_PRICE_IDS, VALID_BILLINGS, type Billing } from '../lib/stripe';
import { VALID_LANGS, SITE_URL, type Lang } from '../lib/config';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

function checkAdminKey(req: VercelRequest): boolean {
  const key = req.headers['x-admin-key'];
  return typeof key === 'string' && key === process.env.ADMIN_KEY;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!checkAdminKey(req)) return res.status(403).end('Forbidden');

  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const rawEmail = req.body?.email;
  if (typeof rawEmail !== 'string') return res.status(400).json({ error: 'invalid-email' });

  const email = rawEmail.trim().toLowerCase();
  if (email.length > 254 || !isEmail(email)) return res.status(400).json({ error: 'invalid-email' });

  const rawName = req.body?.name;
  if (typeof rawName !== 'string' || rawName.trim().length < 2) return res.status(400).json({ error: 'invalid-name' });
  const name = rawName.trim();

  const billing: Billing | undefined = VALID_BILLINGS.includes(req.body?.billing) ? req.body.billing : undefined;
  if (!billing) return res.status(400).json({ error: 'invalid-billing' });

  const rawLang = req.body?.lang;
  const lang: Lang = VALID_LANGS.includes(rawLang) ? rawLang : 'en';

  try {
    const existing = await getActiveSubscription(email);
    if (existing) return res.status(409).json({ error: 'already-subscribed' });

    const customers = await stripe.customers.list({ email, limit: 1 });
    const customer = customers.data.length > 0
      ? await stripe.customers.update(customers.data[0].id, { name })
      : await stripe.customers.create({ email, name });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      customer_update: { address: 'auto' },
      locale: toStripeLocale(lang),
      line_items: [{ price: PREMIUM_PRICE_IDS[billing], quantity: 1 }],
      subscription_data: {
        metadata: { language: lang },
      },
      automatic_tax: { enabled: true },
      success_url: `${SITE_URL}/status?type=subscription-success`,
      cancel_url: `${SITE_URL}/community`,
    });

    return res.status(200).json({ ok: true, url: session.url });
  } catch (err) {
    console.error('[admin-create-premium-session] error:', err);
    return res.status(500).json({ error: 'server-error' });
  }
}
