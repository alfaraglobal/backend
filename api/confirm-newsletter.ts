import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redis, confirmLimiter, checkRateLimit } from '../lib/ratelimit';
import { addContact } from '../lib/resend';
import { SITE_URL, VALID_LANGS, type Lang } from '../lib/config';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end('Method Not Allowed');

  if (!await checkRateLimit(confirmLimiter, req, res)) return;

  const { token, lang: queryLang } = req.query;
  const fallbackLang: Lang = typeof queryLang === 'string' && VALID_LANGS.includes(queryLang as Lang) ? queryLang as Lang : 'en';
  const fallbackPrefix = fallbackLang === 'en' ? '' : `/${fallbackLang}`;

  if (typeof token !== 'string') {
    return res.redirect(302, `${SITE_URL}${fallbackPrefix}/status?type=token-invalid-newsletter`);
  }

  const pending = await redis.get<{ email: string; lang: Lang }>(`nl:pending:${token}`);

  if (!pending) {
    return res.redirect(302, `${SITE_URL}${fallbackPrefix}/status?type=token-invalid-newsletter`);
  }

  const { email, lang } = pending;
  const langPrefix = lang === 'en' ? '' : `/${lang}`;

  try {
    await addContact({ email, lang });
  } catch (err) {
    console.error('[confirm-newsletter] addContact failed:', err);
    return res.redirect(302, `${SITE_URL}${fallbackPrefix}/status?type=500`);
  }

  await redis.del(`nl:pending:${token}`);

  return res.redirect(302, `${SITE_URL}${langPrefix}/status?type=subscribed`);
}
