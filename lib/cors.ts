import type { VercelRequest, VercelResponse } from '@vercel/node';

const PRODUCTION_ORIGINS = ['https://alfaraglobal.com'];

function getAllowedOrigins(): string[] {
  const extra = process.env.ALLOWED_ORIGINS ?? '';
  const extras = extra.split(',').map(o => o.trim()).filter(Boolean);
  return [...PRODUCTION_ORIGINS, ...extras];
}

export function checkOrigin(req: VercelRequest): string | null {
  const origin = req.headers['origin'];
  if (!origin || Array.isArray(origin)) return null;
  return getAllowedOrigins().includes(origin) ? origin : null;
}

export function setCorsHeaders(res: VercelResponse, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function forbidden(res: VercelResponse): void {
  res.status(403).end('Forbidden');
}

export function handlePreflight(req: VercelRequest, res: VercelResponse, origin: string): boolean {
  if (req.method !== 'OPTIONS') return false;
  setCorsHeaders(res, origin);
  res.status(204).end();
  return true;
}
