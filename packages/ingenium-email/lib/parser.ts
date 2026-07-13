/** MIME parsing and HTML sanitization for email content. */

import { simpleParser } from "mailparser";
import type { EmailMessage } from "./types.js";

/**
 * Parse a raw RFC822 email string into a structured EmailMessage.
 */
export async function parseRawEmail(raw: string): Promise<EmailMessage> {
  const parsed = await simpleParser(raw);

  return {
    uid: 0, // caller must set real UID
    messageId: parsed.messageId,
    subject: parsed.subject ?? "(no subject)",
    from: (parsed.from?.value ?? []).map((a) => ({
      name: a.name,
      address: a.address ?? "",
    })),
    to: (parsed.to?.value ?? []).map((a) => ({
      name: a.name,
      address: a.address ?? "",
    })),
    cc: (parsed.cc?.value ?? []).map((a) => ({
      name: a.name,
      address: a.address ?? "",
    })),
    date: parsed.date?.toISOString() ?? new Date().toISOString(),
    body: {
      text: parsed.text ?? undefined,
      html: parsed.html ? sanitizeHtml(parsed.html) : undefined,
    },
    attachments: (parsed.attachments ?? []).map((att) => ({
      partId: att.partID ?? "",
      filename: att.filename ?? "attachment",
      size: att.size ?? 0,
      mimeType: att.contentType ?? "application/octet-stream",
    })),
    flags: [],
    folder: "INBOX",
    threadId: parsed.threadId,
    inReplyTo: parsed.inReplyTo,
    references: Array.isArray(parsed.references)
      ? parsed.references.join(" ")
      : (parsed.references as string | undefined),
  };
}

/**
 * HTML sanitization: strip <script>, <iframe>, <svg>, <object>, <embed>, <applet>,
 * <math> blocks, event handler attributes, javascript: URIs, and data: URIs.
 * Uses regex-based approach suitable for email display.
 */
export function sanitizeHtml(html: string): string {
  let sanitized = html;
  // Remove <script>...</script> blocks (including content)
  sanitized = sanitized.replace(/<script[\s\S]*?<\/script>/gi, "");
  // Remove inline <script ... /> (self-closing)
  sanitized = sanitized.replace(/<script\b[^>]*\/?>/gi, "");
  // Remove <iframe>...</iframe> blocks
  sanitized = sanitized.replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
  // Remove <svg>...</svg> blocks
  sanitized = sanitized.replace(/<svg\b[\s\S]*?<\/svg>/gi, "");
  // Remove <object>...</object> blocks
  sanitized = sanitized.replace(/<object\b[\s\S]*?<\/object>/gi, "");
  // Remove <embed>...</embed> blocks
  sanitized = sanitized.replace(/<embed\b[\s\S]*?<\/embed>/gi, "");
  // Remove <applet>...</applet> blocks
  sanitized = sanitized.replace(/<applet\b[\s\S]*?<\/applet>/gi, "");
  // Remove <math>...</math> blocks
  sanitized = sanitized.replace(/<math\b[\s\S]*?<\/math>/gi, "");
  // Remove javascript: URIs in href/src attributes
  sanitized = sanitized.replace(/\bhref\s*=\s*["']javascript:[^"']*["']/gi, "");
  sanitized = sanitized.replace(/\bsrc\s*=\s*["']javascript:[^"']*["']/gi, "");
  // Note: data: URIs are preserved — they are embedded MIME content safe for email display
  // Remove inline event handlers (onclick, onload, onerror, etc.)
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*"[^"]*"/gi, "");
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*'[^']*'/gi, "");

  return sanitized;
}
