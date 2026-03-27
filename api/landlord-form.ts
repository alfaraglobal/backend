import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'crypto';
import { isEmail } from 'validator';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight } from '../lib/cors';
import { landlordLimiter, checkRateLimit, redis } from '../lib/ratelimit';
import { sendLandlordConfirmationEmail } from '../lib/resend';
import { VALID_LANGS, type Lang } from '../lib/config';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

const TOKEN_TTL_SECONDS = 60 * 60 * 72; // 72 hours
const EMAIL_COOLDOWN_SECONDS = 60 * 10; // 10 minutes

const VALID_RENTAL_TYPES = new Set(['individual_rooms', 'whole_house', 'room_in_your_home']);

const MAX = { name: 50, middleName: 50, surname: 50, email: 254, phone: 25, location: 100, comments: 2000 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = checkOrigin(req);
  if (!origin) return forbidden(res);

  if (handlePreflight(req, res, origin)) return;

  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  if (!await checkRateLimit(landlordLimiter, req, res)) return;

  setCorsHeaders(res, origin);

  const b = req.body ?? {};
  const errors: Record<string, string> = {};

  // — Validation —

  if (typeof b.name !== 'string' || b.name.trim().length < 2 || b.name.length > MAX.name)
    errors.name = 'minChars';

  if (typeof b.surname !== 'string' || b.surname.trim().length < 2 || b.surname.length > MAX.surname)
    errors.surname = 'minChars';

  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!email || email.length > MAX.email || !isEmail(email))
    errors.email = 'invalidEmail';

  if (b.phone !== undefined) {
    if (typeof b.phone !== 'string' || b.phone.length > MAX.phone) {
      errors.phone = 'invalidPhone';
    } else {
      const normalized = b.phone.replace(/\s/g, '');
      const digits = normalized.replace(/\D/g, '');
      if (!/^[+\d\-().]+$/.test(normalized) || digits.length < 7 || digits.length > 15)
        errors.phone = 'invalidPhone';
    }
  }

  if (typeof b.location !== 'string' || b.location.trim().length < 2 || b.location.length > MAX.location)
    errors.location = 'minChars';

  if (b.middle_name !== undefined && (typeof b.middle_name !== 'string' || b.middle_name.length > MAX.middleName))
    errors.middle_name = 'minChars';

  if (b.comments !== undefined && (typeof b.comments !== 'string' || b.comments.length > MAX.comments))
    errors.comments = 'minChars';

  if (typeof b.international_students !== 'boolean')
    errors.international_students = 'selectOne';

  if (
    !Array.isArray(b.rental_type) ||
    b.rental_type.length === 0 ||
    !b.rental_type.every((v: unknown) => typeof v === 'string' && VALID_RENTAL_TYPES.has(v))
  ) errors.rental_type = 'selectAtLeast';

  if (Object.keys(errors).length > 0)
    return res.status(400).json({ ok: false, errors });

  const alreadyConfirmed = await redis.get(`ll:confirmed:${email}`);
  if (alreadyConfirmed) return res.status(200).json({ ok: true });

  // — Cleaning —

  const rawLang = req.body?.lang;
  const lang: Lang = VALID_LANGS.includes(rawLang) ? rawLang : 'en';

  const payload = {
    name: b.name.trim(),
    surname: b.surname.trim(),
    email,
    location: b.location.trim(),
    international_students: b.international_students as boolean,
    rental_type: b.rental_type as string[],
    lang,
    ...(b.middle_name ? { middle_name: (b.middle_name as string).trim() } : {}),
    ...(b.phone ? { phone: b.phone as string } : {}),
    ...(b.comments ? { comments: (b.comments as string).trim() } : {}),
  };

  const onCooldown = await redis.get(`ll:cooldown:${email}`);
  if (onCooldown) return res.status(200).json({ ok: true });

  const token = randomUUID();
  await redis.set(`ll:pending:${token}`, payload, { ex: TOKEN_TTL_SECONDS });
  await redis.set(`ll:cooldown:${email}`, '1', { ex: EMAIL_COOLDOWN_SECONDS });

  try {
    await sendLandlordConfirmationEmail(email, lang, token, payload);
  } catch (err) {
    console.error('[landlord-form] email send failed:', err);
    await redis.del(`ll:pending:${token}`);
    await redis.del(`ll:cooldown:${email}`);
    return res.status(500).json({ error: 'server-error' });
  }

  return res.status(200).json({ ok: true });
}
