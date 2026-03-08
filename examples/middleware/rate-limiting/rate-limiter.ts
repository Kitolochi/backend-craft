import type { Request, Response, NextFunction } from "express";

// ---- Rate Limit Headers (IETF draft-ietf-httpapi-ratelimit-headers) ----

function setRateLimitHeaders(
  res: Response,
  limit: number,
  remaining: number,
  resetMs: number
): void {
  res.set("RateLimit-Limit", String(limit));
  res.set("RateLimit-Remaining", String(Math.max(0, remaining)));
  res.set("RateLimit-Reset", String(Math.ceil(resetMs / 1000)));
  res.set("RateLimit-Policy", `${limit};w=${Math.ceil(resetMs / 1000)}`);
}

function sendTooManyRequests(res: Response, retryAfterMs: number): void {
  res.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
  res.status(429).json({
    error: "Too Many Requests",
    retryAfter: Math.ceil(retryAfterMs / 1000),
  });
}

// ---- Sliding Window Rate Limiter ----

interface SlidingWindowOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
  keyFn?: (req: Request) => string;
}

interface WindowEntry {
  timestamps: number[];
}

/**
 * Sliding window counter: counts requests within a rolling time window.
 * More accurate than fixed windows — no boundary burst problem.
 */
export function slidingWindowLimiter(options: SlidingWindowOptions) {
  const store = new Map<string, WindowEntry>();
  const { windowMs, maxRequests, keyPrefix = "sw" } = options;

  // Clean old entries periodically
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) store.delete(key);
    }
  }, windowMs);

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${keyPrefix}:${options.keyFn?.(req) ?? req.ip}`;
    const now = Date.now();
    const cutoff = now - windowMs;

    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= maxRequests) {
      const oldestInWindow = entry.timestamps[0];
      const retryAfter = oldestInWindow + windowMs - now;
      setRateLimitHeaders(res, maxRequests, 0, retryAfter);
      sendTooManyRequests(res, retryAfter);
      return;
    }

    entry.timestamps.push(now);
    const remaining = maxRequests - entry.timestamps.length;
    const resetMs = entry.timestamps[0] + windowMs - now;
    setRateLimitHeaders(res, maxRequests, remaining, resetMs);
    next();
  };
}

// ---- Token Bucket Rate Limiter ----

interface TokenBucketOptions {
  bucketSize: number;       // Max tokens (burst capacity)
  refillRate: number;       // Tokens added per interval
  refillIntervalMs: number; // Interval between refills
  keyFn?: (req: Request) => string;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

/**
 * Token bucket: allows bursts up to bucket size, then steady rate.
 * Better for APIs where occasional bursts are acceptable.
 */
export function tokenBucketLimiter(options: TokenBucketOptions) {
  const buckets = new Map<string, Bucket>();
  const { bucketSize, refillRate, refillIntervalMs } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = options.keyFn?.(req) ?? req.ip ?? "unknown";
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: bucketSize, lastRefill: now };
      buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const refills = Math.floor(elapsed / refillIntervalMs);
    if (refills > 0) {
      bucket.tokens = Math.min(bucketSize, bucket.tokens + refills * refillRate);
      bucket.lastRefill = now;
    }

    if (bucket.tokens < 1) {
      const nextRefill = refillIntervalMs - (elapsed % refillIntervalMs);
      setRateLimitHeaders(res, bucketSize, 0, nextRefill);
      sendTooManyRequests(res, nextRefill);
      return;
    }

    bucket.tokens--;
    setRateLimitHeaders(res, bucketSize, Math.floor(bucket.tokens), refillIntervalMs);
    next();
  };
}

// ---- Tiered Rate Limiter ----

interface TieredOptions {
  tiers: Record<string, { windowMs: number; maxRequests: number }>;
  identifyTier: (req: Request) => string;
}

/**
 * Different rate limits based on user tier (free/pro/enterprise).
 * Uses sliding window per tier.
 */
export function tieredLimiter(options: TieredOptions) {
  const limiters = new Map<string, ReturnType<typeof slidingWindowLimiter>>();

  for (const [tier, config] of Object.entries(options.tiers)) {
    limiters.set(tier, slidingWindowLimiter({
      ...config,
      keyPrefix: `tier:${tier}`,
    }));
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const tier = options.identifyTier(req);
    const limiter = limiters.get(tier);
    if (!limiter) {
      next();
      return;
    }
    // Add tier info to response headers
    res.set("X-RateLimit-Tier", tier);
    limiter(req, res, next);
  };
}
