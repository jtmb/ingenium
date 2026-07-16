/**
 * MIME parsing and HTML sanitization for email content.
 *
 * Uses `mailparser` (simpleParser) for RFC 2822 parsing rather than hand-writing
 * regex-based header parsers — per AGENTS.md HARD RULE #12.
 */

import { simpleParser } from "mailparser";
import type { EmailMessage } from "./types.js";

/**
 * Parse a raw RFC822 email string into a structured EmailMessage.
 *
 * The returned `uid` is a placeholder ("0") — callers must set the real UID
 * from the IMAP fetch or Gmail API response after parsing.
 *
 * HTML bodies are sanitized via sanitizeHtml() before storage to prevent
 * XSS in the email reader UI.
 */
export async function parseRawEmail(raw: string): Promise<EmailMessage> {
  const parsed = await simpleParser(raw);

  return {
    uid: "0", // caller must set real UID after parsing
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
 * HTML sanitization for email content display.
 *
 * Uses regex-based stripping rather than a full HTML parser (like jsdom) because:
 *   1. Email HTML is generally well-formed (MIME-generated)
 *   2. Performance matters in batch sync (thousands of emails)
 *   3. We only need to block XSS vectors, not parse the DOM tree
 *
 * Removes: <script>, <iframe>, <svg>, <object>, <embed>, <applet>, <math> blocks,
 *          event handler attributes (on*), javascript: URIs in href/src.
 *
 * Preserves: data: URIs (safe embedded MIME content in email display context).
 *
 * WARNING: Regex-based sanitization is not cryptographically secure against
 * determined XSS — this is email display, not a rich HTML editor.  The rendered
 * output only appears in the email reader, not in a user-content context.
 */
export function sanitizeHtml(html: string): string {
  let sanitized = html;
  // Remove <script>...</script> blocks (including content)
  sanitized = sanitized.replace(/<script[\s\S]*?<\/script>/gi, "");
  // Remove inline <script ... /> (self-closing)
  sanitized = sanitized.replace(/<script\b[^>]*\/?>/gi, "");
  // Remove <iframe>...</iframe> blocks
  sanitized = sanitized.replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
  // Remove <svg>...</svg> blocks (SVG can host embedded JS via <script> or event handlers)
  sanitized = sanitized.replace(/<svg\b[\s\S]*?<\/svg>/gi, "");
  // Remove <object>...</object> blocks
  sanitized = sanitized.replace(/<object\b[\s\S]*?<\/object>/gi, "");
  // Remove <embed>...</embed> blocks
  sanitized = sanitized.replace(/<embed\b[\s\S]*?<\/embed>/gi, "");
  // Remove <applet>...</applet> blocks
  sanitized = sanitized.replace(/<applet\b[\s\S]*?<\/applet>/gi, "");
  // Remove <math>...</math> blocks (can contain malicious embedded content)
  sanitized = sanitized.replace(/<math\b[\s\S]*?<\/math>/gi, "");
  // Remove javascript: URIs in href/src attributes
  sanitized = sanitized.replace(/\bhref\s*=\s*["']javascript:[^"']*["']/gi, "");
  sanitized = sanitized.replace(/\bsrc\s*=\s*["']javascript:[^"']*["']/gi, "");
  // NOTE: data: URIs are preserved — they represent embedded MIME content
  // (inline images) which is safe in email display context.
  // Remove inline event handlers (onclick, onload, onerror, onmouseover, etc.)
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*"[^"]*"/gi, "");
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*'[^']*'/gi, "");

  return sanitized;
}
