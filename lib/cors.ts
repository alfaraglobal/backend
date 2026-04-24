import type { VercelRequest, VercelResponse } from '@vercel/node';

const DOMAIN = 'alfaraglobal.com';

function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:') return false;
    return url.hostname === DOMAIN || url.hostname.endsWith(`.${DOMAIN}`);
  } catch {
    return false;
  }
}

function getExtraOrigins(): string[] {
  const extra = process.env.ALLOWED_ORIGINS ?? '';
  return extra.split(',').map(o => o.trim()).filter(Boolean);
}

export function checkOrigin(req: VercelRequest): string | null {
  const origin = req.headers['origin'];
  if (!origin || Array.isArray(origin)) return null;
  if (isAllowedOrigin(origin)) return origin;
  if (getExtraOrigins().includes(origin)) return origin;
  return null;
}

export function setCorsHeaders(res: VercelResponse, origin: string, extraHeaders?: string[]): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  const previewHeader = process.env.PREVIEW_KEY ? ['x-preview-key'] : [];
  const headers = ['Content-Type', ...previewHeader, ...(extraHeaders ?? [])].join(', ');
  res.setHeader('Access-Control-Allow-Headers', headers);
}

export function checkPreviewKey(req: VercelRequest, res: VercelResponse): boolean {
  const previewKey = process.env.PREVIEW_KEY;
  if (!previewKey) return true;
  if (req.headers['x-preview-key'] !== previewKey) {
    res.status(401).end('Unauthorized');
    return false;
  }
  return true;
}

export function forbidden(res: VercelResponse): void {
  res.status(403).end('Forbidden');
}

export function handlePreflight(req: VercelRequest, res: VercelResponse, origin: string, extraHeaders?: string[]): boolean {
  if (req.method !== 'OPTIONS') return false;
  setCorsHeaders(res, origin, extraHeaders);
  res.status(204).end();
  return true;
}
