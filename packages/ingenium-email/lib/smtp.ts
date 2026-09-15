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
import { simpleParser } from "mailparser";
import type { EmailAccount, OAuthToken, EmailAddress } from "./types.js";
import { resolveProviderEndpoints } from "./providers.js";
import { connectAccount } from "./imap.js";
import { ProviderOperationError, sanitizeProviderError } from "./provider-errors.js";

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
  const config = resolveProviderEndpoints(account);
  const { host, port } = config.smtp;

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
      throw new ProviderOperationError("AUTH_REQUIRED", "smtp", false);
    }
    smtpOptions.auth = {
      type: "OAuth2",
      user: account.email,
      accessToken,
    };
  } else {
    const pass = auth.password ?? "";
    if (!pass) {
      throw new ProviderOperationError("AUTH_REQUIRED", "smtp", false);
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
  try {
    const transport = await createTransport(account, auth);
    const result = await transport.sendMail(buildMessage(account, options));
    return result.messageId;
  } catch (error: unknown) {
    throw sanitizeProviderError(error, "smtp");
  }
}

/**
 * Save a draft by generating RFC822 locally and appending it to Drafts via IMAP.
 */
export async function saveDraft(
  account: EmailAccount,
  auth: { password?: string; tokens?: OAuthToken },
  options: SendOptions,
): Promise<string> {
  if (!await hasValidRecipients(options.to, true)
    || !await hasValidRecipients(options.cc, false)
    || !await hasValidRecipients(options.bcc, false)) {
    throw new ProviderOperationError("PROVIDER_REJECTED", "imap", false);
  }

  try {
    const draftTransport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: "windows",
    });
    const result = await draftTransport.sendMail(buildMessage(account, options));
    const message = (result as { message?: Buffer | string }).message;
    if (!message) throw new ProviderOperationError("PROVIDER_ERROR", "imap", true);

    const client = await connectAccount(account, auth);
    await client.append("Drafts", Buffer.isBuffer(message) ? message : Buffer.from(message), ["\\Draft"]);
    return result.messageId;
  } catch (error: unknown) {
    throw sanitizeProviderError(error, "imap");
  }
}

async function hasValidRecipients(
  recipients: EmailAddress[] | undefined,
  required: boolean,
): Promise<boolean> {
  if (!Array.isArray(recipients)) return !required;
  if (required && recipients.length === 0) return false;

  for (const recipient of recipients) {
    if (!recipient || typeof recipient.address !== "string") return false;
    const address = recipient.address.trim();
    if (!address || /[\r\n]/.test(address)) return false;

    try {
      // Delegate RFC 2822 parsing to mailparser rather than maintaining an address regex.
      const parsed = await simpleParser(`To: ${address}\r\n\r\n`);
      const parsedRecipients = parsed.to?.value ?? [];
      if (parsedRecipients.length !== 1
        || !parsedRecipients[0]?.address
        || !address.includes("@")
        || parsedRecipients[0].address.trim().toLowerCase() !== address.toLowerCase()) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

/** Format an EmailAddress as a display string (quoted display name if present). */
function addressString(a: EmailAddress): string {
  return a.name ? `"${a.name}" <${a.address}>` : a.address;
}

function buildMessage(
  account: EmailAccount,
  options: SendOptions,
): Parameters<nodemailer.Transporter["sendMail"]>[0] {
  return {
    from: `"${account.name}" <${account.email}>`,
    to: options.to.map((address) => addressString(address)),
    cc: options.cc?.map((address) => addressString(address)),
    bcc: options.bcc?.map((address) => addressString(address)),
    subject: options.subject,
    html: options.html,
    text: options.text,
    attachments: options.attachments,
    inReplyTo: options.inReplyTo,
    references: options.references,
  };
}
