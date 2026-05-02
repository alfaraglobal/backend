import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'crypto';
import { isEmail } from 'validator';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight, checkPreviewKey } from '../lib/cors';
import { landlordLimiter, confirmLimiter, checkRateLimit, redis, hashEmail, isOnCooldown, setCooldown } from '../lib/ratelimit';
import { sendLandlordConfirmationEmail, type LandlordPayload } from '../lib/resend';
import { SITE_URL, VALID_LANGS, type Lang, RENTAL_TYPES, type RentalType } from '../lib/config';
import { appendLandlordRow } from '../lib/sheets';
import { normalizePhone } from '../lib/validation';
import { devLog } from '../lib/logger';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

const TOKEN_TTL_SECONDS = 60 * 60 * 72; // 72 hours
const EMAIL_COOLDOWN_SECONDS = 60 * 10; // 10 minutes
const CONFIRMED_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

const MAX = { name: 50, middleName: 50, surname: 50, email: 254, location: 100, comments: 2000 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = checkOrigin(req);

  if (req.method !== 'GET') {
    if (!origin) return forbidden(res);
    if (handlePreflight(req, res, origin)) return;
  }

  if (req.method === 'GET') {
    if (!await checkRateLimit(confirmLimiter, req, res)) return;

    const { token, lang: queryLang } = req.query;
    const fallbackLang: Lang = typeof queryLang === 'string' && VALID_LANGS.includes(queryLang as Lang) ? queryLang as Lang : 'en';
    const fallbackPrefix = fallbackLang === 'en' ? '' : `/${fallbackLang}`;

    if (typeof token !== 'string')
      return res.redirect(302, `${SITE_URL}${fallbackPrefix}/status?type=token-invalid-form-landlord`);

    devLog('landlord-form GET: token:', token);
    const payload = await redis.get<LandlordPayload>(`ll:pending:${token}`);
    devLog('landlord-form GET: payload email:', payload?.email ?? 'not found');
    if (!payload)
      return res.redirect(302, `${SITE_URL}${fallbackPrefix}/status?type=token-invalid-form-landlord`);

    try {
      devLog('landlord-form GET: appending row for:', payload.email);
      await appendLandlordRow(token, payload);
      devLog('landlord-form GET: row appended');
    } catch (err) {
      console.error('[landlord-form] appendLandlordRow failed:', err);
      return res.redirect(302, `${SITE_URL}${fallbackPrefix}/status?type=500`);
    }

    await redis.del(`ll:pending:${token}`);
    await redis.set(`ll:confirmed:${hashEmail(payload.email)}`, '1', { ex: CONFIRMED_TTL_SECONDS });

    return res.redirect(302, `${SITE_URL}${fallbackPrefix}/status?type=form-success-landlord`);
  }

  if (req.method === 'POST') {
    if (!checkPreviewKey(req, res)) return;

    if (!await checkRateLimit(landlordLimiter, req, res)) return;

    setCorsHeaders(res, origin!);

    const b = req.body ?? {};
    const errors: Record<string, string> = {};

    if (typeof b.name !== 'string' || b.name.trim().length < 2 || b.name.length > MAX.name)
      errors.name = 'minChars';

    if (typeof b.surname !== 'string' || b.surname.trim().length < 2 || b.surname.length > MAX.surname)
      errors.surname = 'minChars';

    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    if (!email || email.length > MAX.email || !isEmail(email))
      errors.email = 'invalidEmail';

    let phone: string | undefined;
    if (b.phone !== undefined) {
      if (typeof b.phone !== 'string') {
        errors.phone = 'invalidPhone';
      } else {
        const normalized = normalizePhone(b.phone);
        if (normalized === null) errors.phone = 'invalidPhone';
        else phone = normalized;
      }
    }

    if (typeof b.location !== 'string' || b.location.trim().length < 2 || b.location.length > MAX.location)
      errors.location = 'minChars';

    if (b.middle_name !== undefined && (typeof b.middle_name !== 'string' || b.middle_name.length > MAX.middleName))
      errors.middle_name = 'minChars';

    if (b.comments !== undefined && (typeof b.comments !== 'string' || b.comments.length > MAX.comments))
      errors.comments = 'minChars';

    if (b.consent !== true)
      errors.consent = 'required';

    if (typeof b.international_students !== 'boolean')
      errors.international_students = 'selectOne';

    if (
      !Array.isArray(b.rental_type) ||
      b.rental_type.length === 0 ||
      !b.rental_type.every((v: unknown): v is RentalType => typeof v === 'string' && (RENTAL_TYPES as readonly string[]).includes(v))
    ) errors.rental_type = 'selectAtLeast';

    if (Object.keys(errors).length > 0)
      return res.status(400).json({ ok: false, errors });

    devLog('landlord-form POST: email:', email);
    const alreadyConfirmed = await redis.get(`ll:confirmed:${hashEmail(email)}`);
    devLog('landlord-form POST: alreadyConfirmed:', alreadyConfirmed != null);
    if (alreadyConfirmed) return res.status(200).json({ ok: true });

    const rawLang = req.body?.lang;
    const lang: Lang = VALID_LANGS.includes(rawLang) ? rawLang : 'en';
    devLog('landlord-form POST: lang:', lang);

    const payload = {
      name: b.name.trim(),
      surname: b.surname.trim(),
      email,
      location: b.location.trim(),
      international_students: b.international_students as boolean,
      rental_type: b.rental_type as RentalType[],
      lang,
      ...(b.middle_name ? { middle_name: (b.middle_name as string).trim() } : {}),
      ...(phone ? { phone } : {}),
      ...(b.comments ? { comments: (b.comments as string).trim() } : {}),
      marketing_consent: b.marketing_consent === true,
    };

    if (await isOnCooldown(`ll:cooldown:${hashEmail(email)}`)) {
      devLog('landlord-form POST: on cooldown, returning ok');
      return res.status(200).json({ ok: true });
    }

    const token = randomUUID();
    await redis.set(`ll:pending:${token}`, payload, { ex: TOKEN_TTL_SECONDS });
    await setCooldown(`ll:cooldown:${hashEmail(email)}`, EMAIL_COOLDOWN_SECONDS);
    devLog('landlord-form POST: token created:', token);

    try {
      await sendLandlordConfirmationEmail(email, lang, token, payload);
      devLog('landlord-form POST: confirmation email sent');
    } catch (err) {
      console.error('[landlord-form] email send failed:', err);
      await redis.del(`ll:pending:${token}`);
      await redis.del(`ll:cooldown:${hashEmail(email)}`);
      return res.status(500).json({ error: 'server-error' });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).end('Method Not Allowed');
}
