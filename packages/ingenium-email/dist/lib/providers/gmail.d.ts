/**
 * GmailProvider — MailProvider implementation backed by the Gmail REST API.
 *
 * Uses the thin fetch client in gmail-api.ts. Every method calls
 * `getFreshGmailToken()` to ensure the access token is fresh before
 * making API calls, regardless of the `tokens` parameter passed in.
 *
 * Label → Folder Mapping:
 *   INBOX→INBOX  SENT→Sent  SPAM→Spam  TRASH→Trash
 *   STARRED→Starred  IMPORTANT→Important
 *   Custom labels (type='user') → label name directly
 *   Skipped: DRAFT, CATEGORY_*, CHAT, unknown system labels
 */
import type { MailProvider } from "./mail-provider.js";
export declare const GmailProvider: MailProvider;
//# sourceMappingURL=gmail.d.ts.map