/**
 * Mail Provider interface — abstraction over email backends (IMAP, Microsoft Graph, Gmail API).
 *
 * This interface defines the contract that any mail provider must implement.
 * The existing IMAP path remains dormant and intact; new providers can be plugged in
 * by implementing this interface.
 */

import type { EmailAccount, OAuthToken, EmailFolder, EmailAttachment } from "../types.js";
import type { SendOptions } from "../smtp.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** A write-ready cached email entry (provider → cache layer). */
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
  envelopeJson: string | null;
  /** Distinguish genuinely new messages from label-only changes. */
  changeType?: "added" | "label";
}

// ── Provider Interface ─────────────────────────────────────────────────────

export interface MailProvider {
  /** List folders (mailboxes/labels) for an account. */
  listFolders(account: EmailAccount, tokens: OAuthToken): Promise<EmailFolder[]>;

  /** List message headers for a folder (offline window). */
  listMessages(
    account: EmailAccount,
    tokens: OAuthToken,
    folder: string,
    window: number,
  ): Promise<CachedEmailWrite[]>;

  /** Delta sync — incremental changes since a cursor (Gmail historyId, Graph deltaLink). */
  changesSince(
    account: EmailAccount,
    tokens: OAuthToken,
    cursor: string | null,
  ): Promise<{
    upserts: CachedEmailWrite[];
    deletes: { folder: string; id: string }[];
    newCursor: string;
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

  /** Modify folder/label assignments for a message (Gmail labels, IMAP move). */
  modifyFolders(
    account: EmailAccount,
    tokens: OAuthToken,
    id: string,
    addFolder: string | null,
    removeFolder: string | null,
  ): Promise<void>;
}
