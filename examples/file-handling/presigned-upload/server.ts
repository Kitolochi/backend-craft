/**
 * S3/R2 Presigned URL Upload Server
 *
 * This server implements a presigned URL upload flow, which is the recommended
 * pattern for file uploads in modern applications:
 *
 *   1. Client requests a presigned URL from the server (POST /uploads/presign)
 *   2. Server generates a time-limited PUT URL signed with AWS credentials
 *   3. Client uploads the file directly to S3/R2 using the presigned URL
 *   4. The server never touches the file bytes — saving bandwidth and memory
 *
 * This pattern works with any S3-compatible storage:
 *   - AWS S3
 *   - Cloudflare R2
 *   - MinIO
 *   - DigitalOcean Spaces
 *   - Backblaze B2
 *
 * Environment variables:
 *   BUCKET_NAME        — target bucket name
 *   AWS_REGION         — region (use "auto" for Cloudflare R2)
 *   AWS_ACCESS_KEY_ID  — access key
 *   AWS_SECRET_ACCESS_KEY — secret key
 *   S3_ENDPOINT        — custom endpoint URL (required for R2, MinIO, etc.)
 *   PORT               — server port (default: 3001)
 */

import express, { Request, Response, NextFunction } from "express";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3001;
const BUCKET_NAME = process.env.BUCKET_NAME ?? "my-uploads";
const AWS_REGION = process.env.AWS_REGION ?? "us-east-1";

/**
 * For Cloudflare R2, set S3_ENDPOINT to your R2 endpoint:
 *   https://<ACCOUNT_ID>.r2.cloudflarestorage.com
 *
 * For AWS S3, leave S3_ENDPOINT unset — the SDK resolves it from the region.
 */
const S3_ENDPOINT = process.env.S3_ENDPOINT || undefined;

/** Presigned URLs expire after this many seconds. */
const PRESIGN_EXPIRES_IN = 3600; // 1 hour

/** Maximum allowed file size in bytes (50 MB). */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Allowed MIME types for upload.
 * Extend this list to support additional file types.
 */
const ALLOWED_FILE_TYPES = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/avif",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Text
  "text/plain",
  "text/csv",
]);

// ---------------------------------------------------------------------------
// S3 Client
// ---------------------------------------------------------------------------

/**
 * Creates and returns a configured S3 client.
 *
 * The same client works for AWS S3, Cloudflare R2, and any S3-compatible
 * service — just provide the correct endpoint and credentials.
 */
function createS3Client(): S3Client {
  return new S3Client({
    region: AWS_REGION,
    ...(S3_ENDPOINT && { endpoint: S3_ENDPOINT }),
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
    },
    // R2 requires path-style addressing; it doesn't hurt for regular S3.
    forcePathStyle: true,
  });
}

const s3 = createS3Client();

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const PresignRequestSchema = z.object({
  /** Original file name from the client (used to derive the storage key). */
  fileName: z
    .string()
    .min(1, "fileName is required")
    .max(255, "fileName too long"),

  /** MIME type — must be in the allowlist. */
  fileType: z.string().refine((type) => ALLOWED_FILE_TYPES.has(type), {
    message: `fileType must be one of: ${[...ALLOWED_FILE_TYPES].join(", ")}`,
  }),

  /** File size in bytes — must be within the limit. */
  fileSize: z
    .number()
    .int()
    .positive("fileSize must be positive")
    .max(MAX_FILE_SIZE, `fileSize must not exceed ${MAX_FILE_SIZE} bytes`),
});

const KeyParamSchema = z.object({
  key: z.string().min(1, "key is required"),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates a unique object key.
 *
 * Format: uploads/<uuid>/<sanitized-filename>
 *
 * The UUID prefix prevents collisions and makes keys unpredictable.
 * The original filename is preserved (sanitized) for human readability.
 */
function generateObjectKey(fileName: string): string {
  const id = randomUUID();
  // Strip path separators and null bytes from the file name.
  const safe = fileName.replace(/[/\\:\0]/g, "_");
  return `uploads/${id}/${safe}`;
}

/**
 * Extracts a clean file extension from a MIME type.
 * Used as a fallback when the original filename lacks an extension.
 */
function extensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/csv": ".csv",
  };
  return map[mime] ?? "";
}

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// POST /uploads/presign — Generate a presigned PUT URL
// ---------------------------------------------------------------------------

/**
 * The client calls this endpoint before uploading a file.
 *
 * Flow:
 *   1. Client sends file metadata (name, type, size).
 *   2. Server validates the metadata against the allowlist and size limit.
 *   3. Server generates a unique S3 key and creates a presigned PUT URL.
 *   4. Client receives the URL and uploads the file directly to S3/R2.
 *
 * The presigned URL encodes the allowed Content-Type, so the client must
 * set the correct Content-Type header when uploading.
 */
app.post("/uploads/presign", async (req: Request, res: Response) => {
  const parsed = PresignRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { fileName, fileType, fileSize } = parsed.data;
  const key = generateObjectKey(fileName);

  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: fileType,
      // ContentLength is NOT set on the presigned URL — S3 enforces the
      // Content-Length header from the actual upload request instead.
      // To enforce size server-side, use a bucket policy with a condition
      // on content-length-range.
      Metadata: {
        "original-name": fileName,
        "upload-size": String(fileSize),
      },
    });

    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: PRESIGN_EXPIRES_IN,
    });

    res.json({
      uploadUrl,
      key,
      expiresIn: PRESIGN_EXPIRES_IN,
    });
  } catch (err) {
    console.error("Failed to generate presigned URL:", err);
    res.status(500).json({ error: "Failed to generate presigned URL" });
  }
});

// ---------------------------------------------------------------------------
// GET /uploads/:key(*) — Generate a presigned GET URL for downloading
// ---------------------------------------------------------------------------

/**
 * After a file is uploaded, the client can request a temporary download URL.
 * The :key(*) pattern matches keys that contain slashes (e.g. uploads/uuid/file.pdf).
 */
app.get("/uploads/download/:key(*)", async (req: Request, res: Response) => {
  const parsed = KeyParamSchema.safeParse({ key: req.params.key });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid key" });
    return;
  }

  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: parsed.data.key,
    });

    const downloadUrl = await getSignedUrl(s3, command, {
      expiresIn: PRESIGN_EXPIRES_IN,
    });

    res.json({ downloadUrl, expiresIn: PRESIGN_EXPIRES_IN });
  } catch (err) {
    console.error("Failed to generate download URL:", err);
    res.status(500).json({ error: "Failed to generate download URL" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /uploads/:key(*) — Delete an object from the bucket
// ---------------------------------------------------------------------------

app.delete("/uploads/:key(*)", async (req: Request, res: Response) => {
  const parsed = KeyParamSchema.safeParse({ key: req.params.key });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid key" });
    return;
  }

  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: parsed.data.key,
    });

    await s3.send(command);

    // S3 returns 204 even if the key didn't exist — this is by design.
    res.json({ deleted: true, key: parsed.data.key });
  } catch (err) {
    console.error("Failed to delete object:", err);
    res.status(500).json({ error: "Failed to delete object" });
  }
});

// ---------------------------------------------------------------------------
// GET /uploads — List recent uploads
// ---------------------------------------------------------------------------

/**
 * Lists the most recent uploads in the bucket under the "uploads/" prefix.
 *
 * Uses ListObjectsV2 with a max of 50 keys. In production, you would
 * typically track uploads in a database rather than listing from S3 directly,
 * since S3 listing is eventually consistent and can be slow for large buckets.
 */
app.get("/uploads", async (_req: Request, res: Response) => {
  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: "uploads/",
      MaxKeys: 50,
    });

    const result = await s3.send(command);

    const files = (result.Contents ?? []).map((obj) => ({
      key: obj.Key,
      size: obj.Size,
      lastModified: obj.LastModified,
    }));

    res.json({ files, count: files.length });
  } catch (err) {
    console.error("Failed to list uploads:", err);
    res.status(500).json({ error: "Failed to list uploads" });
  }
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Presigned upload server running on http://localhost:${PORT}`);
  console.log(`Bucket: ${BUCKET_NAME} | Region: ${AWS_REGION}`);
  if (S3_ENDPOINT) {
    console.log(`Custom endpoint: ${S3_ENDPOINT}`);
  }
  console.log();
  console.log("Endpoints:");
  console.log("  POST   /uploads/presign        — get a presigned PUT URL");
  console.log("  GET    /uploads/download/:key   — get a presigned GET URL");
  console.log("  DELETE /uploads/:key            — delete an object");
  console.log("  GET    /uploads                 — list recent uploads");
});
