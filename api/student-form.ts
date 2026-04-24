import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isEmail } from 'validator';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight, checkPreviewKey } from '../lib/cors';
import { studentLimiter, checkRateLimit, redis } from '../lib/ratelimit';
import { appendStudentRow } from '../lib/sheets';
import { VALID_LANGS, type Lang, ACCOMMODATION_TYPES, type AccommodationType, LOCATION_PREFERENCES, type LocationPreference, HOME_VIBES, type HomeVibe, DAILY_RHYTHMS, type DailyRhythm } from '../lib/config';
import { normalizePhone } from '../lib/validation';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

const MAX = { name: 50, middleName: 50, surname: 50, email: 254, nationality: 100, comments: 2000 };
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

  if (!checkPreviewKey(req, res)) return;

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

  if (typeof b.accommodation_type !== 'string' || !(ACCOMMODATION_TYPES as readonly string[]).includes(b.accommodation_type))
    errors.accommodation_type = 'selectOne';

  if (typeof b.location_preference !== 'string' || !(LOCATION_PREFERENCES as readonly string[]).includes(b.location_preference))
    errors.location_preference = 'selectOne';

  const budget = typeof b.budget === 'number' ? b.budget : Number(b.budget);
  if (!Number.isFinite(budget) || budget < BUDGET_MIN || budget > BUDGET_MAX)
    errors.budget = 'invalidBudget';

  if (b.home_vibe !== undefined && (typeof b.home_vibe !== 'string' || !(HOME_VIBES as readonly string[]).includes(b.home_vibe)))
    errors.home_vibe = 'selectOne';

  if (b.daily_rhythm !== undefined && (typeof b.daily_rhythm !== 'string' || !(DAILY_RHYTHMS as readonly string[]).includes(b.daily_rhythm)))
    errors.daily_rhythm = 'selectOne';

  if (Object.keys(errors).length > 0)
    return res.status(400).json({ ok: false, errors });

  // — Payload —

  const lang: Lang = VALID_LANGS.includes(b.lang) ? b.lang : 'en';

  const payload = {
    name: b.name.trim(),
    surname: b.surname.trim(),
    email,
    nationality: b.nationality.trim(),
    arrival_date: b.arrival_date as string,
    departure_date: b.departure_date as string,
    accommodation_type: b.accommodation_type as AccommodationType,
    location_preference: b.location_preference as LocationPreference,
    budget,
    lang,
    ...(b.middle_name ? { middle_name: (b.middle_name as string).trim() } : {}),
    ...(phone ? { phone } : {}),
    ...(b.home_vibe ? { home_vibe: b.home_vibe as HomeVibe } : {}),
    ...(b.daily_rhythm ? { daily_rhythm: b.daily_rhythm as DailyRhythm } : {}),
    ...(b.comments ? { comments: (b.comments as string).trim() } : {}),
  };

  // — Token validation —

  const formToken = typeof b.formToken === 'string' ? b.formToken : null;
  if (!formToken) return res.status(403).json({ error: 'forbidden' });

  const tokenPayload = await redis.get<{ name: string; email: string; phone?: string }>(`premium_form_token:${formToken}`);
  if (!tokenPayload || tokenPayload.email !== email) return res.status(403).json({ error: 'forbidden' });
  if (tokenPayload.phone && payload.phone !== tokenPayload.phone) return res.status(403).json({ error: 'forbidden' });

  // — Append —

  try {
    await appendStudentRow(formToken, payload);
  } catch (err) {
    console.error('[student-form] append failed:', err);
    return res.status(500).json({ error: 'server-error' });
  }

  return res.status(200).json({ ok: true });
}
