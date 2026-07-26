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
export declare function createTransport(account: EmailAccount, auth: {
    password?: string;
    tokens?: OAuthToken;
}): Promise<nodemailer.Transporter>;
/**
 * Send an email and return the resulting message ID.
 * Uses nodemailer.sendMail under the hood which handles MIME construction,
 * attachment encoding, and SMTP delivery.
 */
export declare function sendEmail(account: EmailAccount, auth: {
    password?: string;
    tokens?: OAuthToken;
}, options: SendOptions): Promise<string>;
/**
 * Save a draft by sending via SMTP, then appending a copy to the Drafts IMAP folder.
 *
 * Two-step approach because there's no universal "save draft" SMTP command:
 *   1. Send the message via SMTP (so it gets a Message-ID and is deliverable)
 *   2. Append a raw copy to the IMAP Drafts folder with \\Draft flag
 *
 * If the IMAP append fails, the draft was still sent — non-fatal, logged but not thrown.
 */
export declare function saveDraft(account: EmailAccount, auth: {
    password?: string;
    tokens?: OAuthToken;
}, options: SendOptions): Promise<string>;
//# sourceMappingURL=smtp.d.ts.map