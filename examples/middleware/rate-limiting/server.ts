import express from "express";
import { slidingWindowLimiter, tokenBucketLimiter, tieredLimiter } from "./rate-limiter.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ---- Apply rate limiters to different routes ----

// Global: 100 requests per minute per IP (sliding window)
app.use(slidingWindowLimiter({ windowMs: 60_000, maxRequests: 100 }));

// Auth routes: stricter limits (10 per minute)
app.use(
  "/auth",
  slidingWindowLimiter({ windowMs: 60_000, maxRequests: 10, keyPrefix: "auth" })
);

// API routes: token bucket (burst-friendly)
app.use(
  "/api",
  tokenBucketLimiter({ bucketSize: 20, refillRate: 2, refillIntervalMs: 1000 })
);

// ---- Routes ----

app.get("/", (_req, res) => {
  res.json({ message: "Rate limiting demo", routes: ["/auth/login", "/api/data", "/api/heavy"] });
});

app.post("/auth/login", express.json(), (req, res) => {
  res.json({ message: "Login attempt recorded", email: req.body?.email });
});

// Tiered rate limiting: different limits based on API key tier
const tiered = tieredLimiter({
  tiers: {
    free: { windowMs: 60_000, maxRequests: 10 },
    pro: { windowMs: 60_000, maxRequests: 100 },
    enterprise: { windowMs: 60_000, maxRequests: 1000 },
  },
  identifyTier: (req) => {
    const key = req.headers["x-api-key"] as string | undefined;
    if (key === "pro-key") return "pro";
    if (key === "enterprise-key") return "enterprise";
    return "free";
  },
});

app.get("/api/data", tiered, (_req, res) => {
  res.json({ data: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, value: Math.random() })) });
});

app.get("/api/heavy", tiered, async (_req, res) => {
  await new Promise((r) => setTimeout(r, 100));
  res.json({ result: "Heavy computation done" });
});

app.listen(PORT, () => {
  console.log(`Rate limiting demo on http://localhost:${PORT}`);
  console.log("\nTest rate limits:");
  console.log("  for i in {1..15}; do curl -s localhost:3000/api/data | jq .error; done");
  console.log("  curl -H 'X-API-Key: pro-key' localhost:3000/api/data");
});
