/**
 * SMTP sending via nodemailer with OAuth2 or password auth.
 *
 * 🔴 OAuth fallthrough guard: if authType is "oauth2" but accessToken is
 *    missing/empty, throw a clear error instead of silently falling through
 *    to password auth (which would fail with "No password configured").
 *
 * For Gmail, SMTP is also used for sending; GmailProvider uses the REST API
 * instead (gmails.ts sendMessage), but the SMTP path remains for app-password
 * and non-Gmail accounts.
 */

import nodemailer from "nodemailer";
import type { EmailAccount, OAuthToken, EmailAddress } from "./types.js";
import { PROVIDERS } from "./providers.js";
import { connectAccount } from "./imap.js";

/** Options for composing and sending an email.
 *
 * At least one of `html` or `text` should be provided (though SMTP technically
 * allows empty body).  `inReplyTo` and `references` are used for thread linking.
 */
export interface SendOptions {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  html?: string;
  text?: string;
  /** File attachments — content (Buffer/string) or path-based. path is resolved on the server. */
  attachments?: Array<{
    filename: string;
    content?: string | Buffer;
    path?: string;
    contentType?: string;
  }>;
  /** Message-ID this reply responds to (for thread linking). */
  inReplyTo?: string;
  /** References header for thread linking (space-separated Message-IDs). */
  references?: string;
}

/**
 * Create a nodemailer transport for the given account and auth.
 *
 * Uses port 465 (implicit TLS) if the provider config specifies TLS for that port;
 * otherwise uses STARTTLS on port 587.  Nodemailer handles the TLS negotiation.
 */
export async function createTransport(
  account: EmailAccount,
  auth: { password?: string; tokens?: OAuthToken },
): Promise<nodemailer.Transporter> {
  const config = PROVIDERS[account.provider];
  const host = account.smtpHost || config.smtp.host;
  const port = account.smtpPort || config.smtp.port;

  // Build SMTP options with OAuth2 or password auth
  const smtpOptions: Record<string, unknown> = {
    host,
    port,
    // Only use secure (implicit TLS) on port 465 — port 587 uses STARTTLS
    secure: config.smtp.tls && port === 465,
  };

  // 🔴 OAuth fallthrough guard: if authType is "oauth2" but accessToken is
  //    missing/empty, throw a clear error instead of falling through to
  //    password auth (which would fail with "No password configured").
  if (account.authType === "oauth2") {
    const accessToken = auth.tokens?.accessToken;
    if (!accessToken) {
      throw new Error(
        `OAuth2 account "${account.email}" has no access token for SMTP. ` +
        `Tokens may be expired or not yet provisioned. Re-authenticate the account.`,
      );
    }
    smtpOptions.auth = {
      type: "OAuth2",
      user: account.email,
      accessToken,
    };
  } else {
    const pass = auth.password ?? "";
    if (!pass) {
      throw new Error(
        `Account "${account.email}" has no password configured for SMTP. ` +
        `Provide appPassword credentials or switch to OAuth2.`,
      );
    }
    smtpOptions.auth = {
      user: account.email,
      pass,
    };
  }

  return nodemailer.createTransport(smtpOptions as nodemailer.TransportOptions);
}

/**
 * Send an email and return the resulting message ID.
 * Uses nodemailer.sendMail under the hood which handles MIME construction,
 * attachment encoding, and SMTP delivery.
 */
export async function sendEmail(
  account: EmailAccount,
  auth: { password?: string; tokens?: OAuthToken },
  options: SendOptions,
): Promise<string> {
  const transport = await createTransport(account, auth);

  const result = await transport.sendMail({
    from: `"${account.name}" <${account.email}>`,
    to: options.to.map((a) => addressString(a)),
    cc: options.cc?.map((a) => addressString(a)),
    bcc: options.bcc?.map((a) => addressString(a)),
    subject: options.subject,
    html: options.html,
    text: options.text,
    attachments: options.attachments,
    inReplyTo: options.inReplyTo,
    references: options.references,
  });

  return result.messageId;
}

/**
 * Save a draft by sending via SMTP, then appending a copy to the Drafts IMAP folder.
 *
 * Two-step approach because there's no universal "save draft" SMTP command:
 *   1. Send the message via SMTP (so it gets a Message-ID and is deliverable)
 *   2. Append a raw copy to the IMAP Drafts folder with \\Draft flag
 *
 * If the IMAP append fails, the draft was still sent — non-fatal, logged but not thrown.
 */
export async function saveDraft(
  account: EmailAccount,
  auth: { password?: string; tokens?: OAuthToken },
  options: SendOptions,
): Promise<string> {
  const messageId = await sendEmail(account, auth, options);

  // Also append to Drafts folder via IMAP
  try {
    const client = await connectAccount(account, auth);
    // Build a raw MIME message from options
    const raw = buildDraftRaw(account, options, messageId);
    await client.append("Drafts", raw, ["\\Draft"]);
  } catch {
    // Non-fatal: draft still sent via SMTP
  }

  return messageId;
}

/** Format an EmailAddress as a display string (quoted display name if present). */
function addressString(a: EmailAddress): string {
  return a.name ? `"${a.name}" <${a.address}>` : a.address;
}

/** Build a minimal raw RFC822 draft message from options for IMAP append. */
function buildDraftRaw(
  account: EmailAccount,
  options: SendOptions,
  messageId: string,
): string {
  const lines: string[] = [];
  lines.push(`From: "${account.name}" <${account.email}>`);
  lines.push(`To: ${options.to.map((a) => addressString(a)).join(", ")}`);
  if (options.cc?.length) lines.push(`Cc: ${options.cc.map((a) => addressString(a)).join(", ")}`);
  lines.push(`Subject: ${options.subject}`);
  lines.push(`Message-ID: ${messageId}`);
  if (options.inReplyTo) lines.push(`In-Reply-To: ${options.inReplyTo}`);
  if (options.references) lines.push(`References: ${options.references}`);
  lines.push("MIME-Version: 1.0");
  lines.push('Content-Type: text/html; charset="UTF-8"');
  lines.push("");
  lines.push(options.html ?? options.text ?? "");
  return lines.join("\r\n");
}
