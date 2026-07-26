/**
 * Thin fetch client for Gmail REST API (gmail.googleapis.com/gmail/v1).
 *
 * All functions accept a ready-to-use `token: string`. The caller is responsible
 * for ensuring the token is fresh (use `getFreshGmailToken` from oauth.ts).
 *
 * Errors cross this boundary only as sanitized provider errors. Provider response
 * bodies and URLs can contain secrets, mailbox data, or correlation canaries and
 * are intentionally not retained for logging.
 *
 * 🔴 Rate limits: Gmail API allows 250 quota units per second per user.
 *   - messages.get = 5 units
 *   - messages.list = 1 unit
 *   - history.list = 1 unit
 *   - attachments.get = 5 units
 *   - messages.send = 100 units
 *   - messages.modify = 5 units
 */
/** Get the authenticated user's Gmail profile. */
export declare function getProfile(token: string): Promise<{
    emailAddress: string;
    historyId: string;
}>;
/** List all labels for the authenticated user. */
export declare function listLabels(token: string): Promise<{
    id: string;
    name: string;
    type: string;
}[]>;
/** List message IDs for a label. Supports pagination via pageToken. */
export declare function listMessages(token: string, labelId: string, maxResults: number, pageToken?: string): Promise<{
    messages: {
        id: string;
    }[];
    nextPageToken?: string;
}>;
/**
 * Fetch full message details for multiple IDs.
 *
 * Uses sequential individual GET calls (not the Gmail batch endpoint) for
 * simplicity. For initial sync of 500 messages, sequential is fine (~20s).
 * Each message.get costs 5 quota units out of 250/sec.
 */
export declare function batchGetMessages(token: string, ids: string[], format?: "metadata" | "full" | "minimal"): Promise<any[]>;
/** Get a single message by ID (used when batch isn't needed). */
export declare function getMessage(token: string, id: string, format?: "metadata" | "full" | "minimal"): Promise<any>;
/** Get history changes since a given historyId. */
export declare function getHistory(token: string, startHistoryId: string): Promise<{
    history?: any[];
    nextPageToken?: string;
    historyId: string;
}>;
/** Get an attachment by messageId + attachmentId. */
export declare function getAttachment(token: string, messageId: string, attachmentId: string): Promise<{
    data: string;
    size: number;
}>;
/** Send a raw RFC822 message (base64url-encoded). */
export declare function sendMessage(token: string, raw: string): Promise<{
    id: string;
}>;
/** Modify labels on a message (add/remove label IDs). */
export declare function modifyMessage(token: string, id: string, addLabelIds?: string[], removeLabelIds?: string[]): Promise<void>;
//# sourceMappingURL=gmail-api.d.ts.map