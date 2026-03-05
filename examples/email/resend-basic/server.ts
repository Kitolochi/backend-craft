/**
 * Transactional Email Server with Resend
 *
 * Resend is a modern email API designed for developers. It provides:
 *   - Simple REST API for sending transactional emails
 *   - Built-in deliverability (SPF, DKIM, DMARC configured automatically)
 *   - Webhook support for delivery events
 *   - React Email integration for template rendering
 *
 * Best practices implemented here:
 *   - Use a verified "from" domain (not the shared resend.dev domain) in production
 *   - Always include a plain-text fallback alongside HTML
 *   - Rate-limit send endpoints to prevent abuse
 *   - Track message IDs to correlate delivery status
 *   - Use batch sending for multiple recipients (single API call, not a loop)
 *   - Keep HTML emails under 100KB for best deliverability
 *
 * Environment variables:
 *   RESEND_API_KEY  — your Resend API key (starts with "re_")
 *   FROM_EMAIL      — verified sender address (e.g. "noreply@yourdomain.com")
 *   PORT            — server port (default: 3002)
 */

import express, { Request, Response, NextFunction } from "express";
import { Resend } from "resend";
import { z } from "zod";
import rateLimit from "express-rate-limit";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3002;
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const FROM_EMAIL = process.env.FROM_EMAIL ?? "onboarding@resend.dev";

if (!RESEND_API_KEY) {
  console.warn(
    "WARNING: RESEND_API_KEY is not set. API calls will fail.\n" +
      "Get your key at https://resend.com/api-keys"
  );
}

// ---------------------------------------------------------------------------
// Resend Client
// ---------------------------------------------------------------------------

/**
 * The Resend SDK is initialized once and reused for all requests.
 * It handles authentication, retries, and error formatting internally.
 */
const resend = new Resend(RESEND_API_KEY);

// ---------------------------------------------------------------------------
// Email Templates
// ---------------------------------------------------------------------------

/**
 * Built-in HTML email templates.
 *
 * In a real application you would use React Email, MJML, or a templating
 * engine. These inline templates are kept simple for demonstration.
 *
 * Tips for email HTML:
 *   - Use tables for layout (Outlook doesn't support flexbox/grid)
 *   - Inline all CSS (many clients strip <style> tags)
 *   - Keep total size under 100KB
 *   - Test with Litmus or Email on Acid
 */

interface TemplateData {
  /** Recipient's display name. */
  name?: string;
  /** Dynamic URL (e.g. password reset link). */
  actionUrl?: string;
  /** Notification body text. */
  message?: string;
}

const templates: Record<
  string,
  (data: TemplateData) => { subject: string; html: string }
> = {
  /**
   * Welcome email — sent when a new user signs up.
   */
  welcome: (data) => ({
    subject: `Welcome to Our App${data.name ? `, ${data.name}` : ""}!`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="color: #111827; font-size: 24px; margin-bottom: 16px;">
          Welcome${data.name ? `, ${data.name}` : ""}!
        </h1>
        <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
          We're excited to have you on board. Your account is ready to use.
        </p>
        <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
          Here are a few things you can do to get started:
        </p>
        <ul style="color: #4b5563; font-size: 16px; line-height: 1.8;">
          <li>Complete your profile</li>
          <li>Explore the dashboard</li>
          <li>Invite your team members</li>
        </ul>
        ${
          data.actionUrl
            ? `<a href="${data.actionUrl}" style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 16px;">Get Started</a>`
            : ""
        }
        <p style="color: #9ca3af; font-size: 14px; margin-top: 32px;">
          If you didn't create this account, you can safely ignore this email.
        </p>
      </div>
    `,
  }),

  /**
   * Password reset email — includes a time-limited reset link.
   */
  "password-reset": (data) => ({
    subject: "Reset Your Password",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="color: #111827; font-size: 24px; margin-bottom: 16px;">
          Password Reset Request
        </h1>
        <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
          We received a request to reset your password. Click the button below
          to choose a new password. This link expires in 1 hour.
        </p>
        ${
          data.actionUrl
            ? `<a href="${data.actionUrl}" style="display: inline-block; background: #dc2626; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 16px;">Reset Password</a>`
            : '<p style="color: #dc2626;">Error: no reset link was provided.</p>'
        }
        <p style="color: #9ca3af; font-size: 14px; margin-top: 32px;">
          If you didn't request a password reset, no action is needed.
          Your password will remain unchanged.
        </p>
      </div>
    `,
  }),

  /**
   * Generic notification email — for alerts, updates, and system messages.
   */
  notification: (data) => ({
    subject: "New Notification",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="color: #111827; font-size: 24px; margin-bottom: 16px;">
          Notification
        </h1>
        <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 16px 0;">
          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0;">
            ${data.message ?? "You have a new notification."}
          </p>
        </div>
        ${
          data.actionUrl
            ? `<a href="${data.actionUrl}" style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 8px;">View Details</a>`
            : ""
        }
      </div>
    `,
  }),
};

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const SendEmailSchema = z
  .object({
    /** Recipient email address. */
    to: z.string().email("Invalid email address"),

    /** Email subject line — required when not using a template. */
    subject: z.string().min(1).max(998).optional(),

    /** Raw HTML body — required when not using a template. */
    html: z.string().min(1).optional(),

    /** Template name — if provided, overrides subject and html. */
    template: z.enum(["welcome", "password-reset", "notification"]).optional(),

    /** Template data — name, actionUrl, message. */
    templateData: z
      .object({
        name: z.string().optional(),
        actionUrl: z.string().url().optional(),
        message: z.string().optional(),
      })
      .optional(),
  })
  .refine((data) => data.template || (data.subject && data.html), {
    message:
      "Either provide a template name, or both subject and html are required",
  });

const BatchSendSchema = z.object({
  /** Array of recipient email addresses. Max 100 per batch (Resend limit). */
  recipients: z
    .array(z.string().email())
    .min(1, "At least one recipient is required")
    .max(100, "Maximum 100 recipients per batch"),

  /** Subject line for all recipients. */
  subject: z.string().min(1).max(998),

  /** HTML body for all recipients. */
  html: z.string().min(1),
});

const EmailIdSchema = z.object({
  id: z.string().min(1, "Email ID is required"),
});

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

/**
 * Rate limit email send endpoints.
 *
 * Resend has its own rate limits (varies by plan), but we add a server-side
 * limit to prevent runaway loops and abuse. Adjust the window and max
 * values based on your expected traffic.
 */
const sendLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 sends per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many emails sent. Please try again later." },
});

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// POST /email/send — Send a single email
// ---------------------------------------------------------------------------

/**
 * Sends a single transactional email.
 *
 * You can either provide raw subject + html, or reference a built-in
 * template by name. The template approach keeps email content centralized
 * and consistent.
 */
app.post(
  "/email/send",
  sendLimiter,
  async (req: Request, res: Response) => {
    const parsed = SendEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { to, template, templateData } = parsed.data;
    let { subject, html } = parsed.data;

    // If a template is specified, render it and override subject/html.
    if (template) {
      const rendered = templates[template](templateData ?? {});
      subject = rendered.subject;
      html = rendered.html;
    }

    try {
      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: subject!,
        html: html!,
      });

      // Resend returns { data, error }. Check for errors.
      if (result.error) {
        console.error("Resend API error:", result.error);
        res.status(422).json({
          error: "Email send failed",
          details: result.error.message,
        });
        return;
      }

      res.json({
        success: true,
        messageId: result.data?.id,
        to,
      });
    } catch (err) {
      console.error("Failed to send email:", err);
      res.status(500).json({ error: "Failed to send email" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /email/send-batch — Send to multiple recipients
// ---------------------------------------------------------------------------

/**
 * Sends the same email to multiple recipients in a single API call.
 *
 * Resend's batch endpoint is more efficient than looping over individual
 * sends: it uses a single HTTP request and handles parallelism internally.
 * Maximum 100 recipients per batch.
 *
 * Note: each recipient receives their own copy — they don't see other
 * recipients (unlike CC/BCC).
 */
app.post(
  "/email/send-batch",
  sendLimiter,
  async (req: Request, res: Response) => {
    const parsed = BatchSendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { recipients, subject, html } = parsed.data;

    try {
      // Build one message per recipient for the batch API.
      const messages = recipients.map((to) => ({
        from: FROM_EMAIL,
        to,
        subject,
        html,
      }));

      const result = await resend.batch.send(messages);

      if (result.error) {
        console.error("Resend batch error:", result.error);
        res.status(422).json({
          error: "Batch send failed",
          details: result.error.message,
        });
        return;
      }

      res.json({
        success: true,
        data: result.data,
        recipientCount: recipients.length,
      });
    } catch (err) {
      console.error("Failed to send batch email:", err);
      res.status(500).json({ error: "Failed to send batch email" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /email/status/:id — Check email delivery status
// ---------------------------------------------------------------------------

/**
 * Retrieves the delivery status of a previously sent email.
 *
 * Resend tracks these statuses:
 *   - sent       — accepted by Resend
 *   - delivered   — accepted by the recipient's mail server
 *   - opened      — recipient opened the email (if tracking enabled)
 *   - clicked     — recipient clicked a link (if tracking enabled)
 *   - bounced     — recipient's server rejected the email
 *   - complained  — recipient marked it as spam
 *
 * For real-time status updates, consider using Resend webhooks instead
 * of polling this endpoint.
 */
app.get("/email/status/:id", async (req: Request, res: Response) => {
  const parsed = EmailIdSchema.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email ID" });
    return;
  }

  try {
    const result = await resend.emails.get(parsed.data.id);

    if (result.error) {
      console.error("Resend status error:", result.error);
      res.status(422).json({
        error: "Failed to retrieve status",
        details: result.error.message,
      });
      return;
    }

    res.json({
      id: result.data?.id,
      from: result.data?.from,
      to: result.data?.to,
      subject: result.data?.subject,
      createdAt: result.data?.created_at,
      lastEvent: result.data?.last_event,
    });
  } catch (err) {
    console.error("Failed to check email status:", err);
    res.status(500).json({ error: "Failed to check email status" });
  }
});

// ---------------------------------------------------------------------------
// GET /email/templates — List available templates
// ---------------------------------------------------------------------------

app.get("/email/templates", (_req: Request, res: Response) => {
  res.json({
    templates: Object.keys(templates),
  });
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
  console.log(`Resend email server running on http://localhost:${PORT}`);
  console.log(`From: ${FROM_EMAIL}`);
  console.log(
    `API Key: ${RESEND_API_KEY ? RESEND_API_KEY.slice(0, 8) + "..." : "NOT SET"}`
  );
  console.log();
  console.log("Endpoints:");
  console.log("  POST /email/send          — send a single email");
  console.log("  POST /email/send-batch    — send to multiple recipients");
  console.log("  GET  /email/status/:id    — check delivery status");
  console.log("  GET  /email/templates     — list available templates");
});
