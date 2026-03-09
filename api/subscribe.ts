import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'crypto';
import { isEmail } from 'validator';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight } from '../lib/cors';
import { newsletterLimiter, checkRateLimit, redis } from '../lib/ratelimit';
import { sendConfirmationEmail } from '../lib/resend';
import { VALID_LANGS, type Lang } from '../lib/config';

const TOKEN_TTL_SECONDS = 60 * 60 * 24; // 24 hours

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

  if (!isEmail(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const rawLang = req.body?.lang;
  const lang: Lang = VALID_LANGS.includes(rawLang) ? rawLang : 'en';

  const token = randomUUID();
  await redis.set(`nl:pending:${token}`, email, { ex: TOKEN_TTL_SECONDS });

  await sendConfirmationEmail(email, lang, token);

  return res.status(200).json({ ok: true });
}
