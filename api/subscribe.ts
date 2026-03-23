import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'crypto';
import { isEmail } from 'validator';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight } from '../lib/cors';
import { newsletterLimiter, checkRateLimit, redis } from '../lib/ratelimit';
import { sendNewsletterConfirmationEmail } from '../lib/resend';
import { VALID_LANGS, type Lang } from '../lib/config';

const TOKEN_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const EMAIL_COOLDOWN_SECONDS = 60 * 10; // 10 minutes

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = checkOrigin(req);
  if (!origin) return forbidden(res);

  if (handlePreflight(req, res, origin)) return;

  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  if (!await checkRateLimit(newsletterLimiter, req, res)) return;

  setCorsHeaders(res, origin);

  const raw = req.body?.email;

  if (typeof raw !== 'string') {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const email = raw.trim().toLowerCase();

  if (email.length > 254 || !isEmail(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const onCooldown = await redis.get(`nl:cooldown:${email}`);
  if (onCooldown) return res.status(200).json({ ok: true });

  const rawLang = req.body?.lang;
  const lang: Lang = VALID_LANGS.includes(rawLang) ? rawLang : 'en';

  const token = randomUUID();
  await redis.set(`nl:pending:${token}`, { email, lang }, { ex: TOKEN_TTL_SECONDS });
  await redis.set(`nl:cooldown:${email}`, '1', { ex: EMAIL_COOLDOWN_SECONDS });

  await sendNewsletterConfirmationEmail(email, lang, token);

  return res.status(200).json({ ok: true });
}
