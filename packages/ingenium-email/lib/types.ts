/**
 * Email engine types for IMAP/SMTP operations, OAuth2, triage, and response suggestions.
 *
 * 🔴 All `EmailAccount` records live in the global project (see accounts.ts for details).
 */

/** Supported email providers. "custom" allows arbitrary IMAP/SMTP host/port overrides. */
export type EmailProvider = "gmail" | "outlook" | "yahoo" | "custom";

/** Authentication mechanism for IMAP/SMTP. */
export type AuthType = "oauth2" | "app_password";

/** A parsed email address with optional display name. */
export interface EmailAddress {
  name?: string;
  address: string;
}

/** Metadata about a message attachment. */
export interface EmailAttachment {
  partId: string;
  /** Opaque Gmail API token from part.body.attachmentId — not a filename. Never use as display name. */
  attachmentId?: string;
  filename: string;
  size: number;
  mimeType: string;
}

/** An email account configuration (credentials stored separately, encrypted). */
export interface EmailAccount {
  id: string;
  email: string;
  name: string;
  provider: EmailProvider;
  authType: AuthType;
  /** Custom IMAP host override (falls back to provider defaults). */
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  connected: boolean;
  lastSync?: string;
  /** If true, account is hidden from the sidebar dropdown but sync still runs. */
  hidden?: boolean;
}

/** OAuth2 token set with expiry tracking. `refreshToken` is empty for MSAL (handles refresh internally). */
export interface OAuthToken {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when this token expires. Checked with 60s buffer before use. */
  expiryDate: number;
  scope: string;
  email?: string;
}

/** A fully parsed email message (from IMAP fetch or Gmail API). */
export interface EmailMessage {
  uid: string;
  messageId?: string;
  subject: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  date: string;
  body: {
    text?: string;
    /** HTML body, if present. Sanitized before storage (scripts, iframes removed). */
    html?: string;
  };
  attachments: EmailAttachment[];
  flags: string[];
  folder: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

/** Folder/mailbox metadata from IMAP LIST or Gmail labels. */
export interface EmailFolder {
  name: string;
  path: string;
  delimiter: string;
  flags: string[];
  totalMessages: number;
  unreadMessages: number;
}

/** IMAP SEARCH criteria mapped to imapflow's SearchObject. All fields are optional — omitting all returns everything. */
export interface SearchQuery {
  query?: string;
  from?: string;
  to?: string;
  subject?: string;
  /* ISO date string for SINCE criterion. */
  since?: string;
  /* ISO date string for BEFORE criterion. */
  before?: string;
  flagged?: boolean;
  unseen?: boolean;
  answered?: boolean;
}

/** Result of triaging a single email: category, priority, and suggested action with matched skill names. */
export interface TriageResult {
  emailUid: string;
  /** Category label from keyword matching (budget, meeting, urgent, question, update, personal, newsletter, automated, general). */
  category: string;
  priority: "high" | "medium" | "low";
  /** Recommended action based on priority + matched skills. */
  suggestedAction: "reply_now" | "draft" | "review_later" | "ignore";
  /** Names of skills that matched this email's sender or content. */
  matchedSkills: string[];
  /** 0.0–1.0 confidence score. */
  confidence: number;
}

/** A suggested auto-response produced by matching the email against learned skills. */
export interface ResponseSuggestion {
  emailUid: string;
  originalSender: string;
  subject: string;
  /** Filled template body, ready to send or review. */
  body: string;
  matchedSkill: string;
  confidence: number;
}
