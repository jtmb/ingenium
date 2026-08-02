/**
 * MIME parsing and limited HTML filtering for email content.
 *
 * Uses `mailparser` (simpleParser) for RFC 2822 parsing rather than hand-writing
 * regex-based header parsers — per AGENTS.md HARD RULE #12.
 */

import { simpleParser } from "mailparser";
import type { EmailMessage } from "./types.js";

/**
 * Parse a raw RFC822 email string into a structured EmailMessage.
 *
 * The returned `uid` ("0") and `folder` ("INBOX") are placeholders. Callers
 * must replace them from the IMAP fetch or Gmail API response after parsing.
 */
export async function parseRawEmail(raw: string): Promise<EmailMessage> {
  const parsed = await simpleParser(raw);

  return {
    uid: "0",
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
 * Apply limited regex-based filtering before email HTML is rendered.
 * This is not a complete HTML sanitizer and must not be treated as an XSS boundary.
 */
export function sanitizeHtml(html: string): string {
  let sanitized = html;
  sanitized = sanitized.replace(/<script[\s\S]*?<\/script>/gi, "");
  sanitized = sanitized.replace(/<script\b[^>]*\/?>/gi, "");
  sanitized = sanitized.replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
  sanitized = sanitized.replace(/<svg\b[\s\S]*?<\/svg>/gi, "");
  sanitized = sanitized.replace(/<object\b[\s\S]*?<\/object>/gi, "");
  sanitized = sanitized.replace(/<embed\b[\s\S]*?<\/embed>/gi, "");
  sanitized = sanitized.replace(/<applet\b[\s\S]*?<\/applet>/gi, "");
  sanitized = sanitized.replace(/<math\b[\s\S]*?<\/math>/gi, "");
  sanitized = sanitized.replace(/\bhref\s*=\s*["']javascript:[^"']*["']/gi, "");
  sanitized = sanitized.replace(/\bsrc\s*=\s*["']javascript:[^"']*["']/gi, "");
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*"[^"]*"/gi, "");
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*'[^']*'/gi, "");

  return sanitized;
}
