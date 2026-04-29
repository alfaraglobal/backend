import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight } from '../lib/cors';
import { getNewsletterSignedUploadUrl } from '../lib/gcs';
import { redis } from '../lib/ratelimit';
import { VALID_LANGS } from '../lib/config';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

const NEWSLETTER_PREPARE_TTL = 2 * 60 * 60; // 2 hours

function checkAdminKey(req: VercelRequest): boolean {
  const key = req.headers['x-admin-key'];
  return typeof key === 'string' && key === process.env.ADMIN_KEY;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = checkOrigin(req);
  if (!origin) return forbidden(res);

  if (handlePreflight(req, res, origin, ['x-admin-key'])) return;

  if (!checkAdminKey(req)) return res.status(403).end('Forbidden');

  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  setCorsHeaders(res, origin);

  const action = req.body?.action;

  if (action === 'prepare') {
    try {
      const newsletterId = new Date().toISOString().slice(0, 10);

      const uploadEntries = await Promise.all(
        VALID_LANGS.map(async lang => [lang, await getNewsletterSignedUploadUrl(newsletterId, lang)])
      );
      const upload_urls = Object.fromEntries(uploadEntries);

      await redis.set(`newsletter:${newsletterId}`, { status: 'preparing', created_at: Date.now() }, { ex: NEWSLETTER_PREPARE_TTL });

      return res.status(200).json({ newsletter_id: newsletterId, upload_urls });
    } catch (err) {
      console.error('[admin-newsletter] prepare error:', err);
      return res.status(500).json({ error: 'server-error' });
    }
  }

  return res.status(400).json({ error: 'invalid-action' });
}
