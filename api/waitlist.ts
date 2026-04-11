import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isEmail } from 'validator';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight } from '../lib/cors';
import { waitlistLimiter, checkRateLimit, redis } from '../lib/ratelimit';
import { appendWaitlistRow } from '../lib/sheets';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

const EMAIL_COOLDOWN_SECONDS = 60 * 60 * 24; // 24 hours

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = checkOrigin(req);
  if (!origin) return forbidden(res);

  if (handlePreflight(req, res, origin)) return;

  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  if (!await checkRateLimit(waitlistLimiter, req, res)) return;

  setCorsHeaders(res, origin);

  const raw = req.body?.email;

  if (typeof raw !== 'string') {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const email = raw.trim().toLowerCase();

  if (email.length > 254 || !isEmail(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const onCooldown = await redis.get(`wl:cooldown:${email}`);
  if (onCooldown) return res.status(200).json({ ok: true });

  try {
    await appendWaitlistRow(email);
  } catch (err) {
    console.error('[waitlist] sheets append failed:', err);
    return res.status(500).json({ error: 'server-error' });
  }

  await redis.set(`wl:cooldown:${email}`, '1', { ex: EMAIL_COOLDOWN_SECONDS });

  return res.status(200).json({ ok: true });
}
