const PRODUCTION_ORIGINS = ['https://alfaraglobal.com'];

function getAllowedOrigins(): string[] {
  const extra = process.env.ALLOWED_ORIGINS ?? '';
  const extras = extra.split(',').map(o => o.trim()).filter(Boolean);
  return [...PRODUCTION_ORIGINS, ...extras];
}

export function checkOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const allowed = getAllowedOrigins();
  return allowed.includes(origin) ? origin : null;
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export function forbidden(): Response {
  return new Response('Forbidden', { status: 403 });
}

export function handlePreflight(request: Request): Response | null {
  if (request.method !== 'OPTIONS') return null;
  const origin = checkOrigin(request);
  if (!origin) return forbidden();
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
