/**
 * MIME parsing and HTML sanitization for email content.
 *
 * Uses `mailparser` (simpleParser) for RFC 2822 parsing rather than hand-writing
 * regex-based header parsers — per AGENTS.md HARD RULE #12.
 */
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
export declare function parseRawEmail(raw: string): Promise<EmailMessage>;
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
export declare function sanitizeHtml(html: string): string;
//# sourceMappingURL=parser.d.ts.map