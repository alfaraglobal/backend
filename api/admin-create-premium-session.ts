import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'crypto';
import { isEmail } from 'validator';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight } from '../lib/cors';
import { getActiveSubscription } from '../lib/stripe';
import { redis } from '../lib/ratelimit';
import { sendPremiumCheckoutEmail } from '../lib/resend';
import { VALID_LANGS, API_URL, type Lang } from '../lib/config';
import { normalizePhone } from '../lib/validation';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

const PREMIUM_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days

function checkAdminKey(req: VercelRequest): boolean {
  const key = req.headers['x-admin-key'];
  return typeof key === 'string' && key === process.env.ADMIN_KEY;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = checkOrigin(req);
  if (!origin) return forbidden(res);

  if (handlePreflight(req, res, origin, ['x-admin-key'])) return;

  if (!checkAdminKey(req)) return res.status(403).end('Forbidden');

  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  setCorsHeaders(res, origin);

  const rawEmail = req.body?.email;
  if (typeof rawEmail !== 'string') return res.status(400).json({ error: 'invalid-email' });

  const email = rawEmail.trim().toLowerCase();
  if (email.length > 254 || !isEmail(email)) return res.status(400).json({ error: 'invalid-email' });

  const rawName = req.body?.name;
  if (typeof rawName !== 'string' || rawName.trim().length < 2) return res.status(400).json({ error: 'invalid-name' });
  const name = rawName.trim();

  const rawLang = req.body?.lang;
  const lang: Lang = VALID_LANGS.includes(rawLang) ? rawLang : 'en';

  let phone: string | undefined;
  if (req.body?.phone !== undefined) {
    if (typeof req.body.phone !== 'string') return res.status(400).json({ error: 'invalid-phone' });
    const normalized = normalizePhone(req.body.phone);
    if (normalized === null) return res.status(400).json({ error: 'invalid-phone' });
    phone = normalized;
  }

  if (typeof req.body?.marketing_consent !== 'boolean') return res.status(400).json({ error: 'invalid-marketing-consent' });
  const marketing_consent: boolean = req.body.marketing_consent;

  try {
    const existing = await getActiveSubscription(email);
    if (existing) return res.status(409).json({ error: 'already-subscribed' });

    const token = randomBytes(32).toString('hex');
    const formToken = randomBytes(32).toString('hex');

    await Promise.all([
      redis.set(`premium_token:${token}`, { email, name, lang, marketing_consent, ...(phone ? { phone } : {}) }, { ex: PREMIUM_TOKEN_TTL }),
      redis.set(`premium_form_token:${formToken}`, { name, email, ...(phone ? { phone } : {}) }, { ex: PREMIUM_TOKEN_TTL }),
    ]);

    const monthlyUrl = `${API_URL}/api/redeem-premium-session?token=${token}&billing=monthly`;
    const yearlyUrl = `${API_URL}/api/redeem-premium-session?token=${token}&billing=yearly`;

    await sendPremiumCheckoutEmail(email, lang, name, monthlyUrl, yearlyUrl, formToken);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[admin-create-premium-session] error:', err);
    return res.status(500).json({ error: 'server-error' });
  }
}
