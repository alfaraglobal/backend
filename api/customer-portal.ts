import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isEmail } from 'validator';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight, checkPreviewKey } from '../lib/cors';
import { portalLimiter, checkRateLimit, hashEmail, isOnCooldown, setCooldown } from '../lib/ratelimit';
import { stripe, getActiveSubscription, toStripeLocale, STRIPE_PREMIUM_PRODUCT_ID, STRIPE_PORTAL_CONFIG_DEFAULT_ID, STRIPE_PORTAL_CONFIG_PREMIUM_ID } from '../lib/stripe';
import { sendCustomerPortalEmail } from '../lib/resend';
import { VALID_LANGS, SITE_URL, type Lang } from '../lib/config';
import { devLog } from '../lib/logger';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = checkOrigin(req);
  if (!origin) return forbidden(res);

  if (handlePreflight(req, res, origin)) return;

  if (!checkPreviewKey(req, res)) return;

  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  if (!await checkRateLimit(portalLimiter, req, res)) return;

  setCorsHeaders(res, origin);

  const raw = req.body?.email;
  if (typeof raw !== 'string') return res.status(400).json({ error: 'invalid-email' });

  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !isEmail(email)) return res.status(400).json({ error: 'invalid-email' });

  const rawLang = req.body?.lang;
  const lang: Lang = VALID_LANGS.includes(rawLang) ? rawLang : 'en';

  devLog('customer-portal: email:', email, 'lang:', lang);

  if (await isOnCooldown(`portal:cooldown:${hashEmail(email)}`)) {
    devLog('customer-portal: on cooldown, returning ok');
    return res.status(200).json({ ok: true });
  }

  try {
    const subscription = await getActiveSubscription(email);
    devLog('customer-portal: subscription found:', subscription != null);

    if (!subscription) return res.status(200).json({ ok: true });

    const productId = subscription.items.data[0]?.price.product;
    const hasPremium = productId === STRIPE_PREMIUM_PRODUCT_ID;
    const configuration = hasPremium ? STRIPE_PORTAL_CONFIG_PREMIUM_ID : STRIPE_PORTAL_CONFIG_DEFAULT_ID;
    devLog('customer-portal: hasPremium:', hasPremium, 'configuration:', configuration);

    const customer = subscription.customer as string;
    const langPrefix = lang === 'en' ? '' : `/${lang}`;

    const session = await stripe.billingPortal.sessions.create({
      customer,
      configuration,
      return_url: `${SITE_URL}${langPrefix}`,
      locale: toStripeLocale(lang),
    });
    devLog('customer-portal: portal session created:', session.url);

    await sendCustomerPortalEmail(email, lang, session.url, hasPremium);
    devLog('customer-portal: email sent');
    await setCooldown(`portal:cooldown:${hashEmail(email)}`, 60 * 10);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[customer-portal] error:', err);
    return res.status(500).json({ error: 'server-error' });
  }
}
