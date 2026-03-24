import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'crypto';
import { isEmail } from 'validator';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight } from '../lib/cors';
import { studentLimiter, checkRateLimit, redis } from '../lib/ratelimit';
import { sendStudentConfirmationEmail } from '../lib/resend';
import { VALID_LANGS, type Lang } from '../lib/config';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

const TOKEN_TTL_SECONDS = 60 * 60 * 72; // 72 hours
const EMAIL_COOLDOWN_SECONDS = 60 * 10; // 10 minutes

const VALID_ACCOMMODATION_TYPES = new Set(['room_in_shared_flat', 'entire_apartment', 'co_living', 'student_residence', 'i_trust_you']);
const VALID_LOCATION_PREFERENCES = new Set(['university', 'metro', 'center', 'green_area', 'i_trust_you']);
const VALID_HOME_VIBES = new Set(['quiet', 'social', 'between']);
const VALID_DAILY_RHYTHMS = new Set(['early_bird', 'night_owl', 'flexible']);

const MAX = { name: 50, middleName: 50, surname: 50, email: 254, phone: 25, nationality: 100, comments: 2000 };
const BUDGET_MIN = 200;
const BUDGET_MAX = 2500;

function isValidDate(str: unknown): str is string {
  if (typeof str !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str + 'T00:00:00');
  return !isNaN(d.getTime());
}

function parseDate(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = checkOrigin(req);
  if (!origin) return forbidden(res);

  if (handlePreflight(req, res, origin)) return;

  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  if (!await checkRateLimit(studentLimiter, req, res)) return;

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

  if (typeof b.nationality !== 'string' || b.nationality.trim().length < 2 || b.nationality.length > MAX.nationality)
    errors.nationality = 'minChars';

  if (b.middle_name !== undefined && (typeof b.middle_name !== 'string' || b.middle_name.length > MAX.middleName))
    errors.middle_name = 'minChars';

  if (b.comments !== undefined && (typeof b.comments !== 'string' || b.comments.length > MAX.comments))
    errors.comments = 'minChars';

  // — Dates —

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minArrival = addDays(today, 60);

  if (!isValidDate(b.arrival_date) || parseDate(b.arrival_date) < minArrival)
    errors.arrival_date = 'invalidDate';

  if (!isValidDate(b.departure_date)) {
    errors.departure_date = 'invalidDate';
  } else if (!errors.arrival_date) {
    const minDeparture = addDays(parseDate(b.arrival_date), 90);
    if (parseDate(b.departure_date) < minDeparture)
      errors.departure_date = 'invalidDate';
  }

  // — Accommodation —

  if (typeof b.accommodation_type !== 'string' || !VALID_ACCOMMODATION_TYPES.has(b.accommodation_type))
    errors.accommodation_type = 'selectOne';

  if (typeof b.location_preference !== 'string' || !VALID_LOCATION_PREFERENCES.has(b.location_preference))
    errors.location_preference = 'selectOne';

  const budget = typeof b.budget === 'number' ? b.budget : Number(b.budget);
  if (!Number.isFinite(budget) || budget < BUDGET_MIN || budget > BUDGET_MAX)
    errors.budget = 'invalidBudget';

  if (b.home_vibe !== undefined && (typeof b.home_vibe !== 'string' || !VALID_HOME_VIBES.has(b.home_vibe)))
    errors.home_vibe = 'selectOne';

  if (b.daily_rhythm !== undefined && (typeof b.daily_rhythm !== 'string' || !VALID_DAILY_RHYTHMS.has(b.daily_rhythm)))
    errors.daily_rhythm = 'selectOne';

  if (Object.keys(errors).length > 0)
    return res.status(400).json({ ok: false, errors });

  const alreadyConfirmed = await redis.get(`sl:confirmed:${email}`);
  if (alreadyConfirmed) return res.status(200).json({ ok: true });

  // — Cleaning —

  const payload = {
    name: b.name.trim(),
    surname: b.surname.trim(),
    email,
    nationality: b.nationality.trim(),
    arrival_date: b.arrival_date as string,
    departure_date: b.departure_date as string,
    accommodation_type: b.accommodation_type as string,
    location_preference: b.location_preference as string,
    budget,
    newsletter: b.newsletter === true,
    lang: (VALID_LANGS.includes(req.body?.lang) ? req.body.lang : 'en') as Lang,
    ...(b.middle_name ? { middle_name: (b.middle_name as string).trim() } : {}),
    ...(b.phone ? { phone: b.phone as string } : {}),
    ...(b.home_vibe ? { home_vibe: b.home_vibe as string } : {}),
    ...(b.daily_rhythm ? { daily_rhythm: b.daily_rhythm as string } : {}),
    ...(b.comments ? { comments: (b.comments as string).trim() } : {}),
  };

  const onCooldown = await redis.get(`sl:cooldown:${email}`);
  if (onCooldown) return res.status(200).json({ ok: true });

  const rawLang = req.body?.lang;
  const lang: Lang = VALID_LANGS.includes(rawLang) ? rawLang : 'en';

  const token = randomUUID();
  await redis.set(`sl:pending:${token}`, payload, { ex: TOKEN_TTL_SECONDS });
  await redis.set(`sl:cooldown:${email}`, '1', { ex: EMAIL_COOLDOWN_SECONDS });

  const newsletter = b.newsletter === true;
  await sendStudentConfirmationEmail(email, lang, token, payload, newsletter);

  return res.status(200).json({ ok: true });
}
