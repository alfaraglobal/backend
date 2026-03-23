import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redis } from '../lib/ratelimit';
import { addContact } from '../lib/resend';
import { appendStudentRow } from '../lib/sheets';
import { SITE_URL, VALID_LANGS, type Lang } from '../lib/config';
import type { StudentPayload } from '../lib/resend';

const COOLDOWN_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end('Method Not Allowed');

  const { token, lang: queryLang, newsletter: queryNewsletter } = req.query;
  const newsletter = queryNewsletter === '1';
  const fallbackLang: Lang = typeof queryLang === 'string' && VALID_LANGS.includes(queryLang as Lang) ? queryLang as Lang : 'en';
  const fallbackPrefix = fallbackLang === 'en' ? '' : `/${fallbackLang}`;

  const invalidType = newsletter ? 'token-invalid-both' : 'token-invalid-form-student';

  if (typeof token !== 'string') {
    return res.redirect(302, `${SITE_URL}${fallbackPrefix}/status?type=${invalidType}`);
  }

  const payload = await redis.get<StudentPayload>(`sl:pending:${token}`);

  if (!payload) {
    return res.redirect(302, `${SITE_URL}${fallbackPrefix}/status?type=${invalidType}`);
  }

  if (payload.newsletter) {
    const firstName = [payload.name, payload.middle_name].filter(Boolean).join(' ');
    await addContact({ email: payload.email, lang: payload.lang, firstName, lastName: payload.surname });
  }

  await appendStudentRow(token, payload);

  await redis.del(`sl:pending:${token}`);
  await redis.set(`sl:confirmed:${payload.email}`, '1', { ex: COOLDOWN_TTL_SECONDS });

  const successType = payload.newsletter ? 'form-and-subscribed' : 'form-success-student';
  return res.redirect(302, `${SITE_URL}${fallbackPrefix}/status?type=${successType}`);
}
