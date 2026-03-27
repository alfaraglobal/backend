import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// 5 requests per IP per 10 minutes
export const newsletterLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '10 m'),
  prefix: 'rl:newsletter',
});

// 3 requests per IP per 10 minutes
export const landlordLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, '10 m'),
  prefix: 'rl:landlord',
});

// 3 requests per IP per 10 minutes
export const studentLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, '10 m'),
  prefix: 'rl:student',
});

// 10 requests per IP per 10 minutes (shared across all confirm endpoints)
export const confirmLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '10 m'),
  prefix: 'rl:confirm',
});

export async function checkRateLimit(
  limiter: Ratelimit,
  req: VercelRequest,
  res: VercelResponse
): Promise<boolean> {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim()
    ?? req.socket.remoteAddress
    ?? 'unknown';

  const { success } = await limiter.limit(ip);

  if (!success) {
    res.status(429).end('Too Many Requests');
    return false;
  }

  return true;
}
