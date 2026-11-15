import { Redis } from '@upstash/redis';
import type { CartItem } from '../../shared/types.js';

const hasUpstash =
  Boolean(process.env.UPSTASH_REDIS_REST_URL) && Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

const upstashClient = hasUpstash
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

const memoryCarts = new Map<string, CartItem[]>();
const memoryOtp = new Map<string, { code: string; expiresAt: number }>();
const memoryRateLimits = new Map<string, { count: number; resetAt: number }>();

export async function getCartCache(key: string): Promise<CartItem[] | null> {
  if (upstashClient) {
    try {
      const data = await upstashClient.get<CartItem[]>(`cart:${key}`);
      return data ?? null;
    } catch {
      return memoryCarts.get(key) ?? null;
    }
  }
  return memoryCarts.get(key) ?? null;
}

export async function setCartCache(key: string, items: CartItem[]): Promise<void> {
  memoryCarts.set(key, items);
  if (upstashClient) {
    try {
      await upstashClient.set(`cart:${key}`, items, { ex: 60 * 60 * 24 * 14 });
    } catch {
      // Fallback already cached in memory
    }
  }
}

export async function deleteCartCache(key: string): Promise<void> {
  memoryCarts.delete(key);
  if (upstashClient) {
    try {
      await upstashClient.del(`cart:${key}`);
    } catch {
      // ignore
    }
  }
}

export async function storeOtp(phone: string, code: string, ttlSeconds = 300): Promise<void> {
  memoryOtp.set(phone, { code, expiresAt: Date.now() + ttlSeconds * 1000 });
  if (upstashClient) {
    try {
      await upstashClient.set(`otp:${phone}`, code, { ex: ttlSeconds });
    } catch {
      // Fallback already stored in memory
    }
  }
}

export async function verifyOtpCode(phone: string, code: string): Promise<boolean> {
  if (upstashClient) {
    try {
      const saved = await upstashClient.get<string>(`otp:${phone}`);
      if (saved && saved === code) {
        await upstashClient.del(`otp:${phone}`);
        return true;
      }
    } catch {
      // Check memory fallback
    }
  }
  const entry = memoryOtp.get(phone);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    memoryOtp.delete(phone);
    return false;
  }
  if (entry.code === code) {
    memoryOtp.delete(phone);
    return true;
  }
  return false;
}

export async function checkRateLimit(
  identifier: string,
  maxRequests = 30,
  windowSeconds = 60
): Promise<{ allowed: boolean; remaining: number }> {
  if (upstashClient) {
    try {
      const rateKey = `rl:${identifier}`;
      const count = await upstashClient.incr(rateKey);
      if (count === 1) {
        await upstashClient.expire(rateKey, windowSeconds);
      }
      return { allowed: count <= maxRequests, remaining: Math.max(0, maxRequests - count) };
    } catch {
      // Fall through to memory limiter
    }
  }
  const now = Date.now();
  const current = memoryRateLimits.get(identifier);
  if (!current || now > current.resetAt) {
    memoryRateLimits.set(identifier, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  current.count += 1;
  return { allowed: current.count <= maxRequests, remaining: Math.max(0, maxRequests - current.count) };
}
