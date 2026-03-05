/**
 * REST CRUD API with Express + Zod
 *
 * A complete, runnable example of a REST API for a "tasks" resource.
 * Demonstrates proper HTTP semantics, Zod validation, pagination,
 * filtering, sorting, and a consistent JSON response envelope.
 *
 * Run: npx tsx server.ts
 * Test: curl http://localhost:3000/tasks
 */

import express, { Request, Response, NextFunction } from "express";
import { z, ZodError } from "zod";

// =============================================================================
// Types & Schemas
// =============================================================================

/** Valid task statuses */
const TaskStatus = z.enum(["active", "completed", "archived"]);
type TaskStatus = z.infer<typeof TaskStatus>;

/** Shape of a task in our store */
interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

/** Schema for creating a new task — all required fields */
const CreateTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).default(""),
  status: TaskStatus.default("active"),
  priority: z.number().int().min(1).max(5).default(3),
});

/** Schema for full replacement (PUT) — same fields, all required */
const UpdateTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000),
  status: TaskStatus,
  priority: z.number().int().min(1).max(5),
});

/** Schema for partial update (PATCH) — every field optional */
const PatchTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: TaskStatus.optional(),
  priority: z.number().int().min(1).max(5).optional(),
});

/** Query parameters for GET /tasks (pagination, filtering, sorting) */
const ListTasksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  status: TaskStatus.optional(),
  sort: z.enum(["createdAt", "updatedAt", "priority", "title"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

/** Route parameter for a single task */
const TaskIdParamSchema = z.object({
  id: z.string().uuid("Invalid task ID format"),
});

// =============================================================================
// Consistent Response Envelope
// =============================================================================

/**
 * Every response uses this shape:
 *   { data: T, meta?: {...} }        on success
 *   { error: { message, details? } } on failure
 */
interface SuccessResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

interface ErrorResponse {
  error: {
    message: string;
    details?: unknown;
  };
}

function success<T>(data: T, meta?: Record<string, unknown>): SuccessResponse<T> {
  return meta ? { data, meta } : { data };
}

function error(message: string, details?: unknown): ErrorResponse {
  return { error: details ? { message, details } : { message } };
}

// =============================================================================
// In-Memory Store
// =============================================================================

let tasks: Task[] = [];
let idCounter = 0;

/** Generate a simple UUID v4 (good enough for demo purposes) */
function generateId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Seed some initial data so the API is immediately interesting */
function seedData(): void {
  const now = new Date().toISOString();
  const seeds: Omit<Task, "id" | "createdAt" | "updatedAt">[] = [
    { title: "Set up CI/CD pipeline", description: "Configure GitHub Actions for the monorepo", status: "active", priority: 1 },
    { title: "Write API documentation", description: "Document all REST endpoints with examples", status: "active", priority: 2 },
    { title: "Fix login redirect bug", description: "Users are redirected to /undefined after login", status: "completed", priority: 1 },
    { title: "Add dark mode toggle", description: "Implement theme switching with CSS variables", status: "active", priority: 3 },
    { title: "Archive old projects", description: "Move projects older than 1 year to archive", status: "archived", priority: 5 },
  ];

  tasks = seeds.map((seed, i) => ({
    ...seed,
    id: generateId(),
    createdAt: new Date(Date.now() - (seeds.length - i) * 86400000).toISOString(),
    updatedAt: now,
  }));
}

// =============================================================================
// Error Handling Middleware
// =============================================================================

/**
 * Centralized error handler. Catches:
 *   - ZodError  -> 422 Unprocessable Entity with field-level details
 *   - Known app errors (status set on error object)
 *   - Unknown errors -> 500 Internal Server Error
 */
function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  // Zod validation errors -> 422
  if (err instanceof ZodError) {
    const fieldErrors = err.errors.map((e) => ({
      path: e.path.join("."),
      message: e.message,
    }));

    res.status(422).json(error("Validation failed", fieldErrors));
    return;
  }

  // App errors with a status code
  if (err instanceof Error && "status" in err) {
    const status = (err as Error & { status: number }).status;
    res.status(status).json(error(err.message));
    return;
  }

  // Unexpected errors
  console.error("Unhandled error:", err);
  res.status(500).json(error("Internal server error"));
}

/** Create an error with an HTTP status code attached */
function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

// =============================================================================
// Express App & Routes
// =============================================================================

const app = express();

// Parse JSON bodies
app.use(express.json());

// ---------------------------------------------------------------------------
// GET /tasks — List with pagination, filtering, and sorting
// ---------------------------------------------------------------------------
app.get("/tasks", (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = ListTasksQuerySchema.parse(req.query);

    // 1. Filter
    let filtered = tasks;
    if (query.status) {
      filtered = filtered.filter((t) => t.status === query.status);
    }

    // 2. Sort
    filtered = [...filtered].sort((a, b) => {
      const aVal = a[query.sort];
      const bVal = b[query.sort];
      if (aVal < bVal) return query.order === "asc" ? -1 : 1;
      if (aVal > bVal) return query.order === "asc" ? 1 : -1;
      return 0;
    });

    // 3. Paginate
    const total = filtered.length;
    const totalPages = Math.ceil(total / query.limit) || 1;
    const start = (query.page - 1) * query.limit;
    const page = filtered.slice(start, start + query.limit);

    res.json(
      success(page, {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
      })
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /tasks/:id — Fetch a single task
// ---------------------------------------------------------------------------
app.get("/tasks/:id", (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = TaskIdParamSchema.parse(req.params);
    const task = tasks.find((t) => t.id === id);

    if (!task) {
      throw httpError(404, `Task ${id} not found`);
    }

    res.json(success(task));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /tasks — Create a new task
// ---------------------------------------------------------------------------
app.post("/tasks", (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = CreateTaskSchema.parse(req.body);
    const now = new Date().toISOString();

    const task: Task = {
      id: generateId(),
      ...body,
      createdAt: now,
      updatedAt: now,
    };

    tasks.push(task);

    // 201 Created with the new resource
    res.status(201).json(success(task));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /tasks/:id — Full replacement update
// ---------------------------------------------------------------------------
app.put("/tasks/:id", (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = TaskIdParamSchema.parse(req.params);
    const body = UpdateTaskSchema.parse(req.body);
    const index = tasks.findIndex((t) => t.id === id);

    if (index === -1) {
      throw httpError(404, `Task ${id} not found`);
    }

    // Replace all mutable fields, preserve id and createdAt
    tasks[index] = {
      ...tasks[index],
      ...body,
      updatedAt: new Date().toISOString(),
    };

    res.json(success(tasks[index]));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /tasks/:id — Partial update (only provided fields change)
// ---------------------------------------------------------------------------
app.patch("/tasks/:id", (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = TaskIdParamSchema.parse(req.params);
    const body = PatchTaskSchema.parse(req.body);
    const index = tasks.findIndex((t) => t.id === id);

    if (index === -1) {
      throw httpError(404, `Task ${id} not found`);
    }

    // Only overwrite the fields that were actually sent
    tasks[index] = {
      ...tasks[index],
      ...body,
      updatedAt: new Date().toISOString(),
    };

    res.json(success(tasks[index]));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /tasks/:id — Remove a task
// ---------------------------------------------------------------------------
app.delete("/tasks/:id", (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = TaskIdParamSchema.parse(req.params);
    const index = tasks.findIndex((t) => t.id === id);

    if (index === -1) {
      throw httpError(404, `Task ${id} not found`);
    }

    tasks.splice(index, 1);

    // 204 No Content — successful deletion, no body
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Register the centralized error handler (must be after all routes)
app.use(errorHandler);

// =============================================================================
// Start Server
// =============================================================================

const PORT = process.env.PORT || 3000;

seedData();

app.listen(PORT, () => {
  console.log(`REST CRUD API running at http://localhost:${PORT}`);
  console.log(`\nTry these commands:`);
  console.log(`  curl http://localhost:${PORT}/tasks`);
  console.log(`  curl http://localhost:${PORT}/tasks?status=active&sort=priority&order=asc`);
  console.log(`  curl http://localhost:${PORT}/tasks?page=1&limit=2`);
  console.log(`  curl -X POST http://localhost:${PORT}/tasks -H "Content-Type: application/json" -d '{"title":"New task"}'`);
  console.log(`  curl -X PATCH http://localhost:${PORT}/tasks/<id> -H "Content-Type: application/json" -d '{"status":"completed"}'`);
  console.log(`  curl -X DELETE http://localhost:${PORT}/tasks/<id>`);
});
