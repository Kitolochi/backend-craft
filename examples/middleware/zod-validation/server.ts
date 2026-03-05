/**
 * Zod Validation Middleware Pattern
 *
 * A generic, reusable validate() middleware factory that accepts Zod schemas
 * for body, params, and query. Parsed values replace the raw request properties
 * so route handlers receive typed, validated data.
 *
 * Run: npx tsx server.ts
 * Test: curl http://localhost:3000/users?page=1&limit=5
 */

import express, { Request, Response, NextFunction } from "express";
import { z, ZodError, ZodSchema } from "zod";

// =============================================================================
// Generic Validation Middleware
// =============================================================================

/**
 * Specifies which parts of the request to validate.
 * Each key is optional — only the provided schemas are checked.
 */
interface ValidationSchemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

/**
 * Factory that returns Express middleware for request validation.
 *
 * How it works:
 *   1. Parses each specified part of the request (body, params, query)
 *      against its Zod schema.
 *   2. On success, replaces req.body / req.params / req.query with the
 *      parsed (and potentially transformed/defaulted) values.
 *   3. On failure, returns a 422 response with structured field-level errors.
 *
 * Usage:
 *   app.post("/items", validate({ body: CreateItemSchema }), handler);
 *   app.get("/items/:id", validate({ params: IdParamSchema }), handler);
 *   app.get("/items", validate({ query: PaginationSchema }), handler);
 */
function validate(schemas: ValidationSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: Array<{ location: string; path: string; message: string }> = [];

    // Validate each specified part of the request
    for (const [location, schema] of Object.entries(schemas) as Array<
      [keyof ValidationSchemas, ZodSchema]
    >) {
      if (!schema) continue;

      const source = req[location as "body" | "params" | "query"];
      const result = schema.safeParse(source);

      if (result.success) {
        // Replace raw values with parsed (coerced, defaulted) values
        // so the route handler gets clean typed data
        (req as Record<string, unknown>)[location] = result.data;
      } else {
        // Collect all field-level errors with their location
        for (const issue of result.error.issues) {
          errors.push({
            location,
            path: issue.path.join("."),
            message: issue.message,
          });
        }
      }
    }

    if (errors.length > 0) {
      res.status(422).json({
        error: {
          message: "Validation failed",
          details: errors,
        },
      });
      return;
    }

    next();
  };
}

// =============================================================================
// Zod Schemas
// =============================================================================

// -- User creation: all fields required --
const CreateUserSchema = z.object({
  name: z
    .string({ required_error: "Name is required" })
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be at most 100 characters"),
  email: z
    .string({ required_error: "Email is required" })
    .email("Must be a valid email address"),
  role: z.enum(["admin", "editor", "viewer"], {
    errorMap: () => ({ message: "Role must be admin, editor, or viewer" }),
  }),
  age: z
    .number({ required_error: "Age is required" })
    .int("Age must be a whole number")
    .min(13, "Must be at least 13 years old")
    .max(150, "Invalid age"),
});

// -- User update: same shape, but every field is optional --
const UpdateUserSchema = CreateUserSchema.partial();

// -- Pagination query parameters (with coercion for query strings) --
const PaginationSchema = z.object({
  page: z.coerce
    .number()
    .int("Page must be a whole number")
    .min(1, "Page must be at least 1")
    .default(1),
  limit: z.coerce
    .number()
    .int("Limit must be a whole number")
    .min(1, "Limit must be at least 1")
    .max(100, "Limit must be at most 100")
    .default(10),
  search: z.string().optional(),
});

// -- Route parameter: UUID id --
const IdParamSchema = z.object({
  id: z.string().uuid("ID must be a valid UUID"),
});

// =============================================================================
// Inferred Types
// =============================================================================

/**
 * z.infer extracts the TypeScript type from a Zod schema.
 * This keeps your types in sync with your validation — the schema
 * is the single source of truth.
 */
type CreateUserInput = z.infer<typeof CreateUserSchema>;
type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
type PaginationInput = z.infer<typeof PaginationSchema>;
type IdParam = z.infer<typeof IdParamSchema>;

// =============================================================================
// In-Memory Store
// =============================================================================

interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  age: number;
  createdAt: string;
}

function generateId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const users: User[] = [
  { id: generateId(), name: "Alice Chen", email: "alice@example.com", role: "admin", age: 32, createdAt: new Date().toISOString() },
  { id: generateId(), name: "Bob Martinez", email: "bob@example.com", role: "editor", age: 28, createdAt: new Date().toISOString() },
  { id: generateId(), name: "Carol Johnson", email: "carol@example.com", role: "viewer", age: 45, createdAt: new Date().toISOString() },
];

// =============================================================================
// Express App & Routes
// =============================================================================

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// GET /users — List users with validated pagination
// Demonstrates: query schema validation with coercion and defaults
// ---------------------------------------------------------------------------
app.get(
  "/users",
  validate({ query: PaginationSchema }),
  (req: Request, res: Response) => {
    // req.query is now typed and parsed — page/limit are numbers, not strings
    const { page, limit, search } = req.query as unknown as PaginationInput;

    let filtered = users;
    if (search) {
      const term = search.toLowerCase();
      filtered = users.filter(
        (u) => u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)
      );
    }

    const total = filtered.length;
    const start = (page - 1) * limit;
    const paged = filtered.slice(start, start + limit);

    res.json({
      data: paged,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  }
);

// ---------------------------------------------------------------------------
// GET /users/:id — Get a single user
// Demonstrates: params schema validation (UUID format check)
// ---------------------------------------------------------------------------
app.get(
  "/users/:id",
  validate({ params: IdParamSchema }),
  (req: Request, res: Response) => {
    const { id } = req.params as unknown as IdParam;
    const user = users.find((u) => u.id === id);

    if (!user) {
      res.status(404).json({ error: { message: `User ${id} not found` } });
      return;
    }

    res.json({ data: user });
  }
);

// ---------------------------------------------------------------------------
// POST /users — Create a user
// Demonstrates: body schema validation with required fields
// ---------------------------------------------------------------------------
app.post(
  "/users",
  validate({ body: CreateUserSchema }),
  (req: Request, res: Response) => {
    const input = req.body as CreateUserInput;

    // Check for duplicate email
    if (users.some((u) => u.email === input.email)) {
      res.status(409).json({ error: { message: "A user with this email already exists" } });
      return;
    }

    const user: User = {
      id: generateId(),
      ...input,
      createdAt: new Date().toISOString(),
    };

    users.push(user);
    res.status(201).json({ data: user });
  }
);

// ---------------------------------------------------------------------------
// PUT /users/:id — Full update (all fields required)
// Demonstrates: combined params + body validation
// ---------------------------------------------------------------------------
app.put(
  "/users/:id",
  validate({ params: IdParamSchema, body: CreateUserSchema }),
  (req: Request, res: Response) => {
    const { id } = req.params as unknown as IdParam;
    const input = req.body as CreateUserInput;
    const index = users.findIndex((u) => u.id === id);

    if (index === -1) {
      res.status(404).json({ error: { message: `User ${id} not found` } });
      return;
    }

    users[index] = { ...users[index], ...input };
    res.json({ data: users[index] });
  }
);

// ---------------------------------------------------------------------------
// PATCH /users/:id — Partial update (only provided fields change)
// Demonstrates: partial schema + params validation together
// ---------------------------------------------------------------------------
app.patch(
  "/users/:id",
  validate({ params: IdParamSchema, body: UpdateUserSchema }),
  (req: Request, res: Response) => {
    const { id } = req.params as unknown as IdParam;
    const input = req.body as UpdateUserInput;
    const index = users.findIndex((u) => u.id === id);

    if (index === -1) {
      res.status(404).json({ error: { message: `User ${id} not found` } });
      return;
    }

    users[index] = { ...users[index], ...input };
    res.json({ data: users[index] });
  }
);

// ---------------------------------------------------------------------------
// DELETE /users/:id — Delete a user
// Demonstrates: params-only validation
// ---------------------------------------------------------------------------
app.delete(
  "/users/:id",
  validate({ params: IdParamSchema }),
  (req: Request, res: Response) => {
    const { id } = req.params as unknown as IdParam;
    const index = users.findIndex((u) => u.id === id);

    if (index === -1) {
      res.status(404).json({ error: { message: `User ${id} not found` } });
      return;
    }

    users.splice(index, 1);
    res.status(204).send();
  }
);

// =============================================================================
// Fallback Error Handler
// =============================================================================

/**
 * Catches any unhandled errors that slip through.
 * The validate() middleware handles its own errors inline,
 * but this catches everything else (e.g. JSON parse errors).
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // Express throws SyntaxError for malformed JSON
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({
      error: { message: "Malformed JSON in request body" },
    });
    return;
  }

  console.error("Unhandled error:", err);
  res.status(500).json({
    error: { message: "Internal server error" },
  });
});

// =============================================================================
// Start Server
// =============================================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Zod validation demo running at http://localhost:${PORT}`);
  console.log(`\nSeeded ${users.length} users. Try these commands:\n`);
  console.log(`  # List with pagination`);
  console.log(`  curl "http://localhost:${PORT}/users?page=1&limit=2"`);
  console.log(`  curl "http://localhost:${PORT}/users?search=alice"`);
  console.log();
  console.log(`  # Create — valid`);
  console.log(`  curl -X POST http://localhost:${PORT}/users \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"name":"Dave","email":"dave@example.com","role":"viewer","age":25}'`);
  console.log();
  console.log(`  # Create — invalid (triggers field-level errors)`);
  console.log(`  curl -X POST http://localhost:${PORT}/users \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"name":"D","email":"not-email","role":"superadmin","age":10}'`);
  console.log();
  console.log(`  # Bad UUID in params`);
  console.log(`  curl http://localhost:${PORT}/users/not-a-uuid`);
  console.log();
  console.log(`  # Bad query params`);
  console.log(`  curl "http://localhost:${PORT}/users?page=-1&limit=999"`);
});
