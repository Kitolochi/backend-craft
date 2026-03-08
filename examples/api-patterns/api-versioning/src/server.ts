/**
 * API Versioning — Three Strategies in One Example
 *
 * Demonstrates the three most common API versioning approaches:
 *   1. URL path   — /v1/products, /v2/products
 *   2. Header     — Accept-Version: 2
 *   3. Query param — /products?version=2
 *
 * All three strategies are wired up simultaneously so you can compare
 * them side by side. A version-extraction middleware normalizes the
 * resolved version onto `req.apiVersion` regardless of which strategy
 * the client used.
 *
 * Run: npx tsx src/server.ts
 * Test:
 *   # URL path versioning
 *   curl http://localhost:3000/v1/products
 *   curl http://localhost:3000/v2/products
 *
 *   # Header versioning
 *   curl http://localhost:3000/products -H "Accept-Version: 1"
 *   curl http://localhost:3000/products -H "Accept-Version: 2"
 *
 *   # Query param versioning
 *   curl "http://localhost:3000/products?version=1"
 *   curl "http://localhost:3000/products?version=2"
 */

import express, { type Request, type Response, type NextFunction } from "express";

// =============================================================================
// Types
// =============================================================================

/** Supported API versions. Add new versions here as the API evolves. */
type ApiVersion = 1 | 2;

const SUPPORTED_VERSIONS: ApiVersion[] = [1, 2];
const DEFAULT_VERSION: ApiVersion = 1;
const LATEST_VERSION: ApiVersion = 2;

/** Extend Express Request to carry the resolved API version. */
declare global {
  namespace Express {
    interface Request {
      apiVersion: ApiVersion;
    }
  }
}

// =============================================================================
// Seed Data
// =============================================================================

/**
 * Internal product representation. This is the "canonical" shape in the
 * database. Each API version projects a different subset or transformation
 * of this data to the client.
 */
interface Product {
  id: string;
  name: string;
  description: string;
  priceInCents: number;
  currency: string;
  category: string;
  tags: string[];
  inStock: boolean;
  stockCount: number;
  createdAt: string;
  updatedAt: string;
}

const products: Product[] = [
  {
    id: "prod_001",
    name: "Mechanical Keyboard",
    description: "Cherry MX Brown switches, hot-swappable, RGB backlit",
    priceInCents: 12999,
    currency: "USD",
    category: "peripherals",
    tags: ["keyboard", "mechanical", "rgb"],
    inStock: true,
    stockCount: 42,
    createdAt: "2024-01-15T10:00:00Z",
    updatedAt: "2024-06-20T14:30:00Z",
  },
  {
    id: "prod_002",
    name: "Wireless Mouse",
    description: "Ergonomic design, 16000 DPI sensor, USB-C charging",
    priceInCents: 7999,
    currency: "USD",
    category: "peripherals",
    tags: ["mouse", "wireless", "ergonomic"],
    inStock: true,
    stockCount: 128,
    createdAt: "2024-02-01T09:00:00Z",
    updatedAt: "2024-07-10T11:15:00Z",
  },
  {
    id: "prod_003",
    name: "USB-C Hub",
    description: "7-in-1: HDMI, 3x USB-A, SD, microSD, USB-C passthrough",
    priceInCents: 4499,
    currency: "USD",
    category: "accessories",
    tags: ["hub", "usb-c", "adapter"],
    inStock: false,
    stockCount: 0,
    createdAt: "2024-03-10T12:00:00Z",
    updatedAt: "2024-08-01T16:45:00Z",
  },
];

// =============================================================================
// Response Shapes — How Versions Differ
// =============================================================================

/**
 * V1 Response: Simple, flat structure.
 * - Price is a formatted string ("$129.99")
 * - Stock is a boolean
 * - No tags, no timestamps
 *
 * This is what your MVP shipped with. It works, but clients need
 * richer data as the product matures.
 */
interface ProductV1 {
  id: string;
  name: string;
  description: string;
  price: string;
  category: string;
  inStock: boolean;
}

/**
 * V2 Response: Richer, structured data.
 * - Price is a nested object with numeric amount and currency
 * - Stock includes exact count and availability status
 * - Tags are included for filtering
 * - Timestamps for cache invalidation
 *
 * V2 is additive — it doesn't remove fields, it restructures
 * and extends. This is the recommended approach to evolving APIs.
 */
interface ProductV2 {
  id: string;
  name: string;
  description: string;
  price: {
    amount: number;
    currency: string;
    formatted: string;
  };
  category: string;
  tags: string[];
  availability: {
    inStock: boolean;
    stockCount: number;
    status: "available" | "low_stock" | "out_of_stock";
  };
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Transform functions — map internal data to versioned response shapes
// ---------------------------------------------------------------------------

function toProductV1(product: Product): ProductV1 {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: `$${(product.priceInCents / 100).toFixed(2)}`,
    category: product.category,
    inStock: product.inStock,
  };
}

function toProductV2(product: Product): ProductV2 {
  const amount = product.priceInCents / 100;
  let status: "available" | "low_stock" | "out_of_stock";
  if (product.stockCount === 0) status = "out_of_stock";
  else if (product.stockCount < 10) status = "low_stock";
  else status = "available";

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: {
      amount,
      currency: product.currency,
      formatted: `$${amount.toFixed(2)}`,
    },
    category: product.category,
    tags: product.tags,
    availability: {
      inStock: product.inStock,
      stockCount: product.stockCount,
      status,
    },
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

// =============================================================================
// Version Extraction Middleware
// =============================================================================

/**
 * Extracts the API version from one of three sources (in priority order):
 *   1. URL path parameter — :version from /v1/... or /v2/...
 *   2. Accept-Version header — "Accept-Version: 2"
 *   3. Query parameter — ?version=2
 *
 * Falls back to DEFAULT_VERSION if none is specified.
 * Returns 400 if the requested version is not supported.
 *
 * This middleware normalizes the version onto req.apiVersion so that
 * route handlers don't need to know which strategy the client used.
 */
function extractVersion(req: Request, res: Response, next: NextFunction): void {
  let raw: string | undefined;

  // 1. Check URL path param (set by Express route like /v:version/...)
  if (req.params.version) {
    raw = req.params.version;
  }

  // 2. Check Accept-Version header
  if (!raw && req.headers["accept-version"]) {
    raw = req.headers["accept-version"] as string;
  }

  // 3. Check query parameter
  if (!raw && req.query.version) {
    raw = req.query.version as string;
  }

  // Parse and validate
  const parsed = raw ? parseInt(raw, 10) : DEFAULT_VERSION;

  if (isNaN(parsed) || !SUPPORTED_VERSIONS.includes(parsed as ApiVersion)) {
    res.status(400).json({
      error: {
        message: `Unsupported API version: ${raw}`,
        supportedVersions: SUPPORTED_VERSIONS,
        latestVersion: LATEST_VERSION,
      },
    });
    return;
  }

  req.apiVersion = parsed as ApiVersion;

  // Set response header so clients know which version they got
  res.setHeader("X-API-Version", req.apiVersion);

  next();
}

// =============================================================================
// Versioned Route Handler
// =============================================================================

/**
 * Shared handler for the products list endpoint.
 * Uses req.apiVersion (set by extractVersion middleware) to decide
 * which response shape to return.
 */
function handleListProducts(req: Request, res: Response): void {
  if (req.apiVersion === 1) {
    res.json({
      data: products.map(toProductV1),
      meta: { version: 1, count: products.length },
    });
    return;
  }

  // V2: richer response with pagination metadata
  res.json({
    data: products.map(toProductV2),
    meta: {
      version: 2,
      count: products.length,
      total: products.length,
      page: 1,
      perPage: products.length,
    },
  });
}

/**
 * Shared handler for the single product endpoint.
 */
function handleGetProduct(req: Request, res: Response): void {
  const product = products.find((p) => p.id === req.params.id);

  if (!product) {
    res.status(404).json({ error: { message: `Product ${req.params.id} not found` } });
    return;
  }

  if (req.apiVersion === 1) {
    res.json({ data: toProductV1(product) });
    return;
  }

  res.json({ data: toProductV2(product) });
}

// =============================================================================
// Express App
// =============================================================================

const app = express();
app.use(express.json());

const PORT = 3000;

// ---------------------------------------------------------------------------
// Strategy 1: URL Path Versioning — /v1/products, /v2/products
//
// Pros: explicit, easy to route, easy to deprecate, cache-friendly
// Cons: duplicated route definitions, URL changes between versions
//
// This is the most common strategy for public APIs (Stripe, GitHub, etc.)
// ---------------------------------------------------------------------------

app.get("/v:version/products", extractVersion, handleListProducts);
app.get("/v:version/products/:id", extractVersion, handleGetProduct);

// ---------------------------------------------------------------------------
// Strategy 2 & 3: Header + Query Param Versioning — /products
//
// These routes have no version in the URL path. The extractVersion
// middleware checks the Accept-Version header and ?version= query param.
//
// Header versioning:
//   Pros: clean URLs, content negotiation semantics
//   Cons: harder to test in browser, not cache-friendly by default
//
// Query param versioning:
//   Pros: easy to test, works in browser address bar
//   Cons: pollutes query string, can conflict with other params
// ---------------------------------------------------------------------------

app.get("/products", extractVersion, handleListProducts);
app.get("/products/:id", extractVersion, handleGetProduct);

// ---------------------------------------------------------------------------
// GET /versions — List supported API versions and their status
// ---------------------------------------------------------------------------
app.get("/versions", (_req: Request, res: Response) => {
  res.json({
    data: {
      versions: [
        {
          version: 1,
          status: "deprecated",
          sunset: "2025-06-01",
          description: "Original API — flat product structure, string prices",
        },
        {
          version: 2,
          status: "current",
          description: "Structured prices, availability details, tags, timestamps",
        },
      ],
      default: DEFAULT_VERSION,
      latest: LATEST_VERSION,
    },
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// =============================================================================
// Start
// =============================================================================

app.listen(PORT, () => {
  console.log(`API Versioning server running on http://localhost:${PORT}`);
  console.log();
  console.log("Strategy 1 — URL path versioning:");
  console.log(`  curl http://localhost:${PORT}/v1/products`);
  console.log(`  curl http://localhost:${PORT}/v2/products`);
  console.log(`  curl http://localhost:${PORT}/v2/products/prod_001`);
  console.log();
  console.log("Strategy 2 — Header versioning:");
  console.log(`  curl http://localhost:${PORT}/products -H "Accept-Version: 1"`);
  console.log(`  curl http://localhost:${PORT}/products -H "Accept-Version: 2"`);
  console.log();
  console.log("Strategy 3 — Query param versioning:");
  console.log(`  curl "http://localhost:${PORT}/products?version=1"`);
  console.log(`  curl "http://localhost:${PORT}/products?version=2"`);
  console.log();
  console.log("Version info:");
  console.log(`  curl http://localhost:${PORT}/versions`);
});
