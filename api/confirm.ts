import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redis } from '../lib/ratelimit';
import { addContact } from '../lib/resend';
import { SITE_URL, VALID_LANGS, type Lang } from '../lib/config';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end('Method Not Allowed');

  const { token, lang: queryLang } = req.query;
  const fallbackLang: Lang = typeof queryLang === 'string' && VALID_LANGS.includes(queryLang as Lang) ? queryLang as Lang : 'en';
  const fallbackPrefix = fallbackLang === 'en' ? '' : `/${fallbackLang}`;

  if (typeof token !== 'string') {
    return res.redirect(302, `${SITE_URL}${fallbackPrefix}/expired`);
  }

  const email = await redis.get<string>(`nl:pending:${token}`);

  if (!email) {
    return res.redirect(302, `${SITE_URL}${fallbackPrefix}/expired`);
  }

  await addContact(email);
  await redis.del(`nl:pending:${token}`);

  return res.redirect(302, `${SITE_URL}${fallbackPrefix}/confirmed`);
}
