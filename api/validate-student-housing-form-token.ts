import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight } from '../lib/cors';
import { confirmLimiter, checkRateLimit, redis } from '../lib/ratelimit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = checkOrigin(req);
  if (!origin) return forbidden(res);

  if (handlePreflight(req, res, origin)) return;

  if (req.method !== 'GET') return res.status(405).end('Method Not Allowed');

  if (!await checkRateLimit(confirmLimiter, req, res)) return;

  setCorsHeaders(res, origin);

  const token = typeof req.query.token === 'string' ? req.query.token : null;
  if (!token) return res.status(400).end();

  const payload = await redis.get<{ name: string; email: string }>(`premium_form_token:${token}`);
  if (!payload) return res.status(404).end();

  return res.status(200).json({ name: payload.name, email: payload.email });
}
