import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight } from '../lib/cors';
import { newsletterLimiter, checkRateLimit } from '../lib/ratelimit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = checkOrigin(req);
  if (!origin) return forbidden(res);

  if (handlePreflight(req, res, origin)) return;

  if (!await checkRateLimit(newsletterLimiter, req, res)) return;

  setCorsHeaders(res, origin);
  res.status(200).send('Hello from Vercel!');
}
