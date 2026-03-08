import { checkOrigin, corsHeaders, forbidden, handlePreflight } from '../lib/cors';

export default {
  fetch(request: Request) {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const origin = checkOrigin(request);
    if (!origin) return forbidden();

    return new Response('Hello from Vercel!', {
      headers: corsHeaders(origin),
    });
  }
}
