import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'crypto';
import { isEmail } from 'validator';
import { getNewsletterSignedDownloadUrl } from '../lib/gcs';
import { stripe, getPlanFromProductId } from '../lib/stripe';
import { removeNewsletterContact } from '../lib/resend';
import { newsletterLimiter, checkRateLimit } from '../lib/ratelimit';
import { VALID_LANGS, SITE_URL, type Lang } from '../lib/config';
import { devLog } from '../lib/logger';

export const config = { api: { bodyParser: false } };

function verifyHmac(secret: string, data: string, token: string): boolean {
  const expected = createHmac('sha256', secret).update(data).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end('Method Not Allowed');

  if (!await checkRateLimit(newsletterLimiter, req, res)) return;

  const { action, id, lang, email, token } = req.query as Record<string, string>;
  const secret = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET!;

  if (action === 'download') {
    if (!id || !lang || !email || !token) return res.status(400).end('Bad Request');
    if (!VALID_LANGS.includes(lang as Lang)) return res.status(400).end('Bad Request');

    const decodedEmail = decodeURIComponent(email);
    devLog('newsletter download: id:', id, 'lang:', lang, 'email:', decodedEmail);
    if (!verifyHmac(secret, `dl:${decodedEmail}:${id}`, token)) return res.status(403).end('Forbidden');

    try {
      const url = await getNewsletterSignedDownloadUrl(id, lang as Lang);
      devLog('newsletter download: signed url generated, redirecting');
      return res.redirect(302, url);
    } catch (err) {
      console.error('[newsletter] download error:', err);
      return res.status(500).end('Server Error');
    }
  }

  if (action === 'unsubscribe') {
    if (!email || !token) return res.status(400).end('Bad Request');

    const decodedEmail = decodeURIComponent(email);
    devLog('newsletter unsubscribe: email:', decodedEmail);
    if (!isEmail(decodedEmail)) return res.status(400).end('Bad Request');
    if (!verifyHmac(secret, `unsub:${decodedEmail}`, token)) return res.status(403).end('Forbidden');

    let statusType = 'newsletter-unsubscribed';
    let langPrefix = '';

    try {
      const customers = await stripe.customers.list({ email: decodedEmail, limit: 1 });
      const customer = customers.data[0];
      if (customer && !('deleted' in customer)) {
        await stripe.customers.update(customer.id, {
          metadata: { marketing_consent: 'false' },
        });

        const language = customer.metadata?.['language'] as string | undefined;
        const customerLang: Lang = VALID_LANGS.includes(language as Lang) ? language as Lang : 'en';
        if (customerLang !== 'en') langPrefix = `/${customerLang}`;

        const subscriptions = await stripe.subscriptions.list({ customer: customer.id, status: 'active', limit: 1 });
        const sub = subscriptions.data[0];
        if (sub) {
          const plan = getPlanFromProductId(sub.items.data[0]?.price.product as string);
          if (plan === 'basic') statusType = 'newsletter-unsubscribed-basic';
        }
      }
    } catch (err) {
      console.error('[newsletter] unsubscribe stripe error:', err);
    }

    const redirectUrl = `${SITE_URL}${langPrefix}/status?type=${statusType}`;
    console.log('[newsletter] unsubscribe redirect:', { email: decodedEmail, statusType, redirectUrl });

    try {
      await removeNewsletterContact(decodedEmail);
      devLog('newsletter unsubscribe: resend contact removed');
    } catch (err) {
      console.error('[newsletter] remove resend error:', err);
    }

    return res.redirect(302, redirectUrl);
  }

  return res.status(400).end('Bad Request');
}
