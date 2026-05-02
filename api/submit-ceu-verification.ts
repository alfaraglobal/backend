import type { VercelRequest, VercelResponse } from '@vercel/node';
import busboy from 'busboy';
import { randomUUID } from 'crypto';
import { isEmail } from 'validator';
import { checkOrigin, setCorsHeaders, forbidden, handlePreflight, checkPreviewKey } from '../lib/cors';
import { ceuVerificationLimiter, checkRateLimit, isOnCooldown, setCooldown, hashEmail } from '../lib/ratelimit';
import { uploadVerificationDoc } from '../lib/gcs';
import { appendCeuVerificationRow } from '../lib/sheets';
import { VALID_LANGS, type Lang } from '../lib/config';
import { normalizePhone } from '../lib/validation';
import { devLog } from '../lib/logger';

export const config = { api: { bodyParser: false } };

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB — stays under Vercel's 4.5MB body limit
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

interface ParsedForm {
  email: string;
  phone: string;
  lang: string;
  consent: boolean;
  marketing_consent: boolean;
  fileBuffer: Buffer | null;
  fileName: string;
  fileMimeType: string;
  fileTooLarge: boolean;
  invalidMimeType: boolean;
}

function parseForm(req: VercelRequest): Promise<ParsedForm> {
  return new Promise((resolve, reject) => {
    const result: ParsedForm = {
      email: '',
      phone: '',
      lang: '',
      consent: false,
      marketing_consent: false,
      fileBuffer: null,
      fileName: '',
      fileMimeType: '',
      fileTooLarge: false,
      invalidMimeType: false,
    };

    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 6 },
    });

    bb.on('field', (key, val) => {
      if (key === 'email') result.email = val.trim().toLowerCase();
      if (key === 'phone') result.phone = val.trim();
      if (key === 'lang') result.lang = val.trim();
      if (key === 'consent') result.consent = val === 'true';
      if (key === 'marketing_consent') result.marketing_consent = val === 'true';
    });

    bb.on('file', (field, stream, info) => {
      if (field !== 'document') { stream.resume(); return; }

      result.fileMimeType = info.mimeType;
      result.fileName = info.filename;

      if (!ALLOWED_MIME_TYPES.includes(info.mimeType)) {
        result.invalidMimeType = true;
        stream.resume();
        return;
      }

      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => { result.fileTooLarge = true; });
      stream.on('end', () => {
        if (!result.fileTooLarge) result.fileBuffer = Buffer.concat(chunks);
      });
    });

    bb.on('finish', () => resolve(result));
    bb.on('error', reject);

    // Vercel Dev buffers the request body before the handler runs, so req.pipe()
    // ends the stream prematurely. Collect the raw body first, then feed it to busboy.
    const rawChunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => rawChunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      bb.write(Buffer.concat(rawChunks));
      bb.end();
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = checkOrigin(req);
  if (!origin) return forbidden(res);

  if (handlePreflight(req, res, origin)) return;

  if (!checkPreviewKey(req, res)) return;

  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  if (!await checkRateLimit(ceuVerificationLimiter, req, res)) return;

  setCorsHeaders(res, origin);

  const form = await parseForm(req).catch((err) => { console.error('[ceu-verification] parseForm error:', err); return null; });
  if (!form) return res.status(400).json({ error: 'invalid-form' });

  const errors: Record<string, string> = {};

  if (!form.consent)
    errors.consent = 'required';

  if (!form.email || form.email.length > 254 || !isEmail(form.email))
    errors.email = 'invalidEmail';

  if (form.phone) {
    const normalized = normalizePhone(form.phone);
    if (normalized === null) errors.phone = 'invalidPhone';
    else form.phone = normalized;
  }

  if (form.invalidMimeType)
    errors.document = 'invalidType';
  else if (form.fileTooLarge)
    errors.document = 'tooLarge';
  else if (!form.fileBuffer)
    errors.document = 'required';

  if (Object.keys(errors).length > 0)
    return res.status(400).json({ ok: false, errors });

  const lang: Lang = VALID_LANGS.includes(form.lang as Lang) ? form.lang as Lang : 'en';

  const cooldownKey = `ceu:cooldown:${hashEmail(form.email)}`;
  if (await isOnCooldown(cooldownKey)) return res.status(200).json({ ok: true });

  const ext = form.fileMimeType === 'application/pdf' ? 'pdf' : form.fileMimeType === 'image/jpeg' ? 'jpg' : 'png';
  const fileName = `${Date.now()}_${randomUUID()}.${ext}`;

  try {
    devLog('uploading to GCS:', fileName);
    const { url: documentUrl, expiry: documentUrlExpiry, authenticatedUrl } = await uploadVerificationDoc(fileName, form.fileMimeType, form.fileBuffer!);
    devLog('GCS upload done, documentUrl:', documentUrl);
    devLog('appending to sheets:', { email: form.email, lang, fileName });
    await appendCeuVerificationRow({ email: form.email, lang, documentUrl, documentUrlExpiry, fileName, authenticatedUrl, marketing_consent: form.marketing_consent, ...(form.phone ? { phone: form.phone } : {}) });
    devLog('sheets append done');
    await setCooldown(cooldownKey, 60 * 60 * 24); // 24 hours
    devLog('cooldown set');
  } catch (err) {
    console.error('[ceu-verification] error:', err);
    return res.status(500).json({ error: 'server-error' });
  }

  return res.status(200).json({ ok: true });
}
