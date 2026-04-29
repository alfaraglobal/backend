import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'crypto';
import { isEmail } from 'validator';
import { getNewsletterSignedDownloadUrl } from '../lib/gcs';
import { stripe, getPlanFromProductId } from '../lib/stripe';
import { removeNewsletterContact } from '../lib/resend';
import { VALID_LANGS, SITE_URL, type Lang } from '../lib/config';

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

  const { action, id, lang, email, token } = req.query as Record<string, string>;
  const secret = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET!;

  if (action === 'download') {
    if (!id || !lang || !email || !token) return res.status(400).end('Bad Request');
    if (!VALID_LANGS.includes(lang as Lang)) return res.status(400).end('Bad Request');

    const decodedEmail = decodeURIComponent(email);
    if (!verifyHmac(secret, `dl:${decodedEmail}:${id}`, token)) return res.status(403).end('Forbidden');

    try {
      const url = await getNewsletterSignedDownloadUrl(id, lang as Lang);
      return res.redirect(302, url);
    } catch (err) {
      console.error('[newsletter] download error:', err);
      return res.status(500).end('Server Error');
    }
  }

  if (action === 'unsubscribe') {
    if (!email || !token) return res.status(400).end('Bad Request');

    const decodedEmail = decodeURIComponent(email);
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
        const lang: Lang = VALID_LANGS.includes(language as Lang) ? language as Lang : 'en';
        if (lang !== 'en') langPrefix = `/${lang}`;

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

    const redirectUrl = `${SITE_URL}${langPrefix}/unsubscribe-success?status=${statusType}`;

    try {
      await removeNewsletterContact(decodedEmail);
    } catch (err) {
      console.error('[newsletter] unsubscribe resend error:', err);
    }

    return res.redirect(302, redirectUrl);
  }

  return res.status(400).end('Bad Request');
}
