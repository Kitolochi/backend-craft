import type { Request, Response, NextFunction } from "express";

interface CachedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  createdAt: number;
}

interface InFlightRequest {
  promise: Promise<void>;
  resolve: () => void;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * In-memory idempotency store.
 * Production: use Redis with TTL for distributed idempotency.
 */
export class IdempotencyStore {
  private cache = new Map<string, CachedResponse>();
  private inFlight = new Map<string, InFlightRequest>();
  private ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;

    // Clean expired entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  get(key: string): CachedResponse | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry;
  }

  set(key: string, response: CachedResponse): void {
    this.cache.set(key, response);
  }

  isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  async waitForInFlight(key: string): Promise<void> {
    const entry = this.inFlight.get(key);
    if (entry) await entry.promise;
  }

  markInFlight(key: string): void {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    this.inFlight.set(key, { promise, resolve });
  }

  clearInFlight(key: string): void {
    const entry = this.inFlight.get(key);
    if (entry) {
      entry.resolve();
      this.inFlight.delete(key);
    }
  }

  stats() {
    return {
      cached: this.cache.size,
      inFlight: this.inFlight.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? ((this.hits / (this.hits + this.misses)) * 100).toFixed(1) + "%"
        : "N/A",
    };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.createdAt > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Idempotency middleware following the IETF Idempotency-Key header draft.
 *
 * Behavior:
 * 1. No Idempotency-Key header → pass through (no caching)
 * 2. Key exists in cache → return cached response immediately
 * 3. Key is in-flight → wait for original request to complete, then return cached
 * 4. New key → process request, cache response, return
 *
 * This prevents double-charging, duplicate orders, etc. when clients retry.
 */
export function idempotencyMiddleware(store: IdempotencyStore) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;

    // No key = no idempotency
    if (!idempotencyKey) {
      next();
      return;
    }

    const cacheKey = `${req.method}:${req.path}:${idempotencyKey}`;

    // Check cache first
    const cached = store.get(cacheKey);
    if (cached) {
      console.log(`[idempotency] Cache hit for key: ${idempotencyKey}`);
      res.set("Idempotency-Key", idempotencyKey);
      res.set("X-Idempotent-Replayed", "true");
      for (const [key, value] of Object.entries(cached.headers)) {
        res.set(key, value);
      }
      res.status(cached.statusCode).json(cached.body);
      return;
    }

    // Check if same key is being processed
    if (store.isInFlight(cacheKey)) {
      console.log(`[idempotency] Waiting for in-flight: ${idempotencyKey}`);
      await store.waitForInFlight(cacheKey);
      const result = store.get(cacheKey);
      if (result) {
        res.set("Idempotency-Key", idempotencyKey);
        res.set("X-Idempotent-Replayed", "true");
        res.status(result.statusCode).json(result.body);
        return;
      }
    }

    // Mark as in-flight and intercept response
    store.markInFlight(cacheKey);

    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      // Cache the response
      store.set(cacheKey, {
        statusCode: res.statusCode,
        headers: { "Content-Type": "application/json" },
        body,
        createdAt: Date.now(),
      });
      store.clearInFlight(cacheKey);

      res.set("Idempotency-Key", idempotencyKey);
      return originalJson(body);
    };

    // Clean up in-flight on error
    res.on("close", () => store.clearInFlight(cacheKey));

    next();
  };
}
