/**
 * Mail Provider interface — abstraction over email backends (IMAP, Microsoft Graph, Gmail API).
 *
 * This interface defines the contract that any mail provider must implement.
 * The existing IMAP path remains dormant and intact; new providers can be plugged in
 * by implementing this interface.
 *
 * 🔴 All methods receive an `OAuthToken` parameter for cross-provider consistency, but
 *    the GmailProvider implementation ignores it and fetches a fresh token internally via
 *    getFreshGmailToken(). This ensures tokens are always current regardless of the caller.
 */

import type { EmailAccount, OAuthToken, EmailFolder, EmailAttachment } from "../types.js";
import type { SendOptions } from "../smtp.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** A write-ready cached email entry (provider → cache layer).
 *  Fields mirror the `email_cache` DB columns for direct upsert.
 */
export interface CachedEmailWrite {
  id: string;
  folder: string;
  subject: string | null;
  fromName: string | null;
  fromAddr: string | null;
  date: string | null;
  snippet: string | null;
  flags: string[];
  hasAttachments: boolean;
  /** JSON blob of To/Cc/Bcc/Message-ID/In-Reply-To/References headers. */
  envelopeJson: string | null;
  /** Distinguish genuinely new messages from label-only changes (Gmail labels added/removed). */
  changeType?: "added" | "label";
}

// ── Provider Interface ─────────────────────────────────────────────────────

export interface MailProvider {
  /** List folders (mailboxes/labels) for an account. */
  listFolders(account: EmailAccount, tokens: OAuthToken): Promise<EmailFolder[]>;

  /** List message headers for a folder within an "offline window" (newest N messages).
   *  Returns CachedEmailWrite[] ready for bulk upsert into email_cache.
   *  The window parameter caps results to avoid 62K+ mailbox scans.
   */
  listMessages(
    account: EmailAccount,
    tokens: OAuthToken,
    folder: string,
    /** Max results to return (offline window cap, e.g. 500). */
    window: number,
  ): Promise<CachedEmailWrite[]>;

  /**
   * Delta sync — incremental changes since a cursor (Gmail historyId, Graph deltaLink).
   *
   * On first call with `cursor=null`, returns `fullResyncRequired: true` plus a
   * non-null `newCursor` so the caller can start polling incrementally.
   *
   * When the cursor has expired (Gmail 404), returns `fullResyncRequired: true`
   * with `newCursor: ""` — caller should clear state and re-init.
   */
  changesSince(
    account: EmailAccount,
    tokens: OAuthToken,
    cursor: string | null,
  ): Promise<{
    upserts: CachedEmailWrite[];
    deletes: { folder: string; id: string }[];
    /** Updated cursor to persist for the next poll. */
    newCursor: string;
    /** If true, the cursor is invalid — caller must full resync before next delta. */
    fullResyncRequired?: boolean;
  }>;

  /** Fetch the full body (HTML, text, attachments) for a message. */
  getBody(
    account: EmailAccount,
    tokens: OAuthToken,
    id: string,
  ): Promise<{ html?: string; text?: string; attachments: EmailAttachment[] }>;

  /** Fetch a single attachment by ID. */
  getAttachment(
    account: EmailAccount,
    tokens: OAuthToken,
    id: string,
    attachmentId: string,
  ): Promise<{ data: Buffer; mimeType: string; filename: string }>;

  /** Send an email. */
  send(
    account: EmailAccount,
    tokens: OAuthToken,
    options: SendOptions,
  ): Promise<void>;

  /** Modify folder/label assignments for a message (Gmail labels, IMAP move/flag). */
  modifyFolders(
    account: EmailAccount,
    tokens: OAuthToken,
    id: string,
    addFolder: string | null,
    removeFolder: string | null,
  ): Promise<void>;
}
