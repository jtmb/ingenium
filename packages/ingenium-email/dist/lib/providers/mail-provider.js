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
export {};
