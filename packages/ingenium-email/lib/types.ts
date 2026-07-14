/** Email engine types for IMAP/SMTP operations, OAuth2, triage, and response suggestions. */

export type EmailProvider = "gmail" | "outlook" | "yahoo" | "custom";

export type AuthType = "oauth2" | "app_password";

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface EmailAttachment {
  partId: string;
  filename: string;
  size: number;
  mimeType: string;
}

export interface EmailAccount {
  id: string;
  email: string;
  name: string;
  provider: EmailProvider;
  authType: AuthType;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  connected: boolean;
  lastSync?: string;
}

export interface OAuthToken {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  scope: string;
  email?: string;
}

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
    html?: string;
  };
  attachments: EmailAttachment[];
  flags: string[];
  folder: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

export interface EmailFolder {
  name: string;
  path: string;
  delimiter: string;
  flags: string[];
  totalMessages: number;
  unreadMessages: number;
}

export interface SearchQuery {
  query?: string;
  from?: string;
  to?: string;
  subject?: string;
  since?: string;
  before?: string;
  flagged?: boolean;
  unseen?: boolean;
  answered?: boolean;
}

export interface TriageResult {
  emailUid: string;
  category: string;
  priority: "high" | "medium" | "low";
  suggestedAction: "reply_now" | "draft" | "review_later" | "ignore";
  matchedSkills: string[];
  confidence: number;
}

export interface ResponseSuggestion {
  emailUid: string;
  originalSender: string;
  subject: string;
  body: string;
  matchedSkill: string;
  confidence: number;
}
