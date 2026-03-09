import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redis } from '../lib/ratelimit';
import { addContact } from '../lib/resend';
import { SITE_URL, type Lang } from '../lib/config';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end('Method Not Allowed');

  const { token } = req.query;

  if (typeof token !== 'string') {
    return res.status(400).end('Invalid token');
  }

  const stored = await redis.get<string>(`nl:pending:${token}`);

  if (!stored) {
    return res.status(410).end('Link expired or already used');
  }

  const { email, lang } = JSON.parse(stored) as { email: string; lang: Lang };
  const langPrefix = lang === 'en' ? '' : `/${lang}`;

  await addContact(email);
  await redis.del(`nl:pending:${token}`);

  return res.redirect(302, `${SITE_URL}${langPrefix}/confirmed`);
}
