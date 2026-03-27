import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redis, confirmLimiter, checkRateLimit } from '../lib/ratelimit';
import { SITE_URL, VALID_LANGS, type Lang } from '../lib/config';
import type { LandlordPayload } from '../lib/resend';
import { appendLandlordRow } from '../lib/sheets';

const COOLDOWN_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end('Method Not Allowed');

  if (!await checkRateLimit(confirmLimiter, req, res)) return;

  const { token, lang: queryLang } = req.query;
  const fallbackLang: Lang = typeof queryLang === 'string' && VALID_LANGS.includes(queryLang as Lang) ? queryLang as Lang : 'en';
  const fallbackPrefix = fallbackLang === 'en' ? '' : `/${fallbackLang}`;

  if (typeof token !== 'string') {
    return res.redirect(302, `${SITE_URL}${fallbackPrefix}/status?type=token-invalid-form-landlord`);
  }

  const payload = await redis.get<LandlordPayload>(`ll:pending:${token}`);

  if (!payload) {
    return res.redirect(302, `${SITE_URL}${fallbackPrefix}/status?type=token-invalid-form-landlord`);
  }

  try {
    await appendLandlordRow(token, payload);
  } catch (err) {
    console.error('[confirm-landlord-form] appendLandlordRow failed:', err);
    return res.redirect(302, `${SITE_URL}${fallbackPrefix}/status?type=500`);
  }

  await redis.del(`ll:pending:${token}`);
  await redis.set(`ll:confirmed:${payload.email}`, '1', { ex: COOLDOWN_TTL_SECONDS });

  return res.redirect(302, `${SITE_URL}${fallbackPrefix}/status?type=form-success-landlord`);
}
