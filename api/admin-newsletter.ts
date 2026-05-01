import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';
import { isEmail } from 'validator';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight } from '../lib/cors';
import { getNewsletterSignedUploadUrl, allNewsletterFilesExist } from '../lib/gcs';
import { listNewsletterContacts, sendNewsletterBatch } from '../lib/resend';
import { type Lang, VALID_LANGS, API_URL } from '../lib/config';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

function buildPayload(email: string, lang: Lang, newsletterId: string, secret: string) {
  const dlToken = createHmac('sha256', secret).update(`dl:${email}:${newsletterId}`).digest('hex');
  const unsubToken = createHmac('sha256', secret).update(`unsub:${email}`).digest('hex');
  const downloadUrls = Object.fromEntries(
    VALID_LANGS.map(l => [
      l,
      `${API_URL}/api/newsletter?action=download&id=${newsletterId}&lang=${l}&email=${encodeURIComponent(email)}&token=${dlToken}`,
    ])
  ) as Record<Lang, string>;
  const unsubUrl = `${API_URL}/api/newsletter?action=unsubscribe&email=${encodeURIComponent(email)}&token=${unsubToken}`;
  return { email, lang, downloadUrls, unsubUrl };
}

async function sendInChunks(payloads: ReturnType<typeof buildPayload>[]) {
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const CHUNK_SIZE = 100;
  for (let i = 0; i < payloads.length; i += CHUNK_SIZE) {
    const chunk = payloads.slice(i, i + CHUNK_SIZE);
    await sendNewsletterBatch(chunk);
    if (i + CHUNK_SIZE < payloads.length) await sleep(200);
  }
}

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

      return res.status(200).json({ newsletter_id: newsletterId, upload_urls });
    } catch (err) {
      console.error('[admin-newsletter] prepare error:', err);
      return res.status(500).json({ error: 'server-error' });
    }
  }

  if (action === 'send') {
    const newsletterId = req.body?.newsletter_id;
    if (typeof newsletterId !== 'string' || !newsletterId.trim()) {
      return res.status(400).json({ error: 'invalid-newsletter-id' });
    }

    try {
      const allExist = await allNewsletterFilesExist(newsletterId, VALID_LANGS);
      console.log('[admin-newsletter] files exist:', allExist, '| newsletter_id:', newsletterId);
      if (!allExist) return res.status(404).json({ error: 'newsletter-files-not-found' });

      const contacts = await listNewsletterContacts();
      console.log('[admin-newsletter] contacts to send to:', contacts.length);
      if (contacts.length === 0) return res.status(200).json({ ok: true, sent: 0 });

      const secret = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET!;
      const payloads = contacts.map(({ email, lang }) => buildPayload(email, lang, newsletterId, secret));

      console.log('[admin-newsletter] sample payload:', JSON.stringify(payloads[0], null, 2));

      await sendInChunks(payloads);

      return res.status(200).json({ ok: true, sent: payloads.length });
    } catch (err) {
      console.error('[admin-newsletter] send error:', err);
      return res.status(500).json({ error: 'server-error' });
    }
  }

  if (action === 'send-targeted') {
    const newsletterId = req.body?.newsletter_id;
    if (typeof newsletterId !== 'string' || !newsletterId.trim()) {
      return res.status(400).json({ error: 'invalid-newsletter-id' });
    }

    const entries: unknown = req.body?.entries;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'invalid-entries' });
    }

    const validEntries: { email: string; lang: Lang }[] = [];
    for (const e of entries) {
      if (typeof e?.email !== 'string') return res.status(400).json({ error: 'invalid-entry-email', entry: e });
      const email = e.email.trim().toLowerCase();
      if (email.length > 254 || !isEmail(email)) return res.status(400).json({ error: 'invalid-entry-email', entry: e });
      if (!VALID_LANGS.includes(e?.lang)) return res.status(400).json({ error: 'invalid-entry-lang', entry: e });
      validEntries.push({ email, lang: e.lang as Lang });
    }

    try {
      const allExist = await allNewsletterFilesExist(newsletterId, VALID_LANGS);
      if (!allExist) return res.status(404).json({ error: 'newsletter-files-not-found' });

      const secret = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET!;
      const payloads = validEntries.map(({ email, lang }) => buildPayload(email, lang, newsletterId, secret));

      await sendInChunks(payloads);

      return res.status(200).json({ ok: true, sent: payloads.length });
    } catch (err) {
      console.error('[admin-newsletter] send-targeted error:', err);
      return res.status(500).json({ error: 'server-error' });
    }
  }

  return res.status(400).json({ error: 'invalid-action' });
}
