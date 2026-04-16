import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';

export function hashEmail(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}

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

// 3 requests per IP per 10 minutes
export const waitlistLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, '10 m'),
  prefix: 'rl:waitlist',
});

// 2 requests per IP per 10 minutes
export const ceuVerificationLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(2, '10 m'),
  prefix: 'rl:ceu-verification',
});

// 10 requests per IP per 10 minutes (shared across all confirm endpoints)
export const confirmLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '10 m'),
  prefix: 'rl:confirm',
});

export async function isOnCooldown(key: string): Promise<boolean> {
  if (process.env.NODE_ENV === 'development') return false;
  return !!(await redis.get(key));
}

export async function setCooldown(key: string, ttlSeconds: number): Promise<void> {
  if (process.env.NODE_ENV === 'development') return;
  await redis.set(key, '1', { ex: ttlSeconds });
}

export async function checkRateLimit(
  limiter: Ratelimit,
  req: VercelRequest,
  res: VercelResponse
): Promise<boolean> {
  if (process.env.NODE_ENV === 'development') return true;

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
