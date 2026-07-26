/**
 * Global email-account persistence.
 *
 * Account metadata and credentials live in settings because mail accounts are
 * shared infrastructure. Every operation resolves the currently assigned
 * global project inside its database transaction; no process-lifetime project
 * identifier is cached.
 */
import type { EmailAccount, OAuthToken, EmailFolder } from "./types.js";
export declare const EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING = "email_encryption_key_fingerprint";
export interface EmailCredentialMigrationValidation {
    valid: boolean;
    hasCredentials: boolean;
    reason?: "ACCOUNT_MALFORMED" | "ACCOUNT_ID_MISMATCH" | "CREDENTIAL_MISSING" | "CREDENTIAL_MALFORMED" | "CREDENTIAL_DECRYPT_FAILED" | "TOKEN_MISMATCH";
}
export type EmailEncryptionStatus = "ready" | "uninitialized" | "unavailable" | "mismatch" | "unverified" | "global-unavailable";
export interface EmailEncryptionDiagnostics {
    status: EmailEncryptionStatus;
    globalProjectId?: string;
}
export declare class EmailEncryptionContinuityError extends Error {
    constructor(message: string);
}
/** Resolve the active global project on every operation. */
export declare function getGlobalProjectId(): string;
/**
 * Validate a legacy account setting before it can be moved into the global
 * namespace. This is intentionally read-only: callers retain every source row
 * unless this function confirms all durable encrypted material decrypts with
 * the active key and belongs to the account named by its setting key.
 */
export declare function validateEmailAccountMigrationCredentials(accountId: string, accountRaw: string, oauthRaw?: string): EmailCredentialMigrationValidation;
/** Non-secret runtime diagnostic for mail startup and health reporting. */
export declare function getEmailEncryptionDiagnostics(): EmailEncryptionDiagnostics;
/** List all global email accounts, ignoring malformed rows rather than crashing mail startup. */
export declare function listAccounts(_projectId: string): EmailAccount[];
export declare function getAccount(_projectId: string, accountId: string): EmailAccount | undefined;
/** Persist non-secret account metadata atomically. */
export declare function addAccount(_projectId: string, account: Omit<EmailAccount, "id" | "connected">): EmailAccount;
/** Create manual account metadata and encrypted credentials in one transaction. */
export declare function createAccountWithCredentials(_projectId: string, account: Omit<EmailAccount, "id" | "connected">, credentials: {
    imapPass?: string;
    smtpPass?: string;
}): EmailAccount;
/** Create an OAuth account and encrypted token record in one transaction. */
export declare function createOAuthAccountWithTokens(_projectId: string, account: Omit<EmailAccount, "id" | "connected">, tokens: OAuthToken): EmailAccount;
export declare function removeAccount(_projectId: string, accountId: string): void;
/** Replace encrypted manual credentials atomically without touching account metadata. */
export declare function storeCredentials(_projectId: string, accountId: string, credentials: {
    imapPass?: string;
    smtpPass?: string;
    tokens?: OAuthToken;
}): void;
/** Store encrypted OAuth tokens atomically after checking the account still exists. */
export declare function storeOAuthTokens(_projectId: string, accountId: string, tokens: OAuthToken): void;
/** Retrieve credentials only when the persisted key-continuity guard is ready. */
export declare function getCredentials(_projectId: string, accountId: string): {
    password?: string;
    tokens?: OAuthToken;
} | undefined;
export declare function testConnection(account: EmailAccount, auth: {
    password?: string;
    tokens?: OAuthToken;
}): Promise<{
    success: boolean;
    folders?: EmailFolder[];
    error?: string;
}>;
export declare function setAccountConnected(_projectId: string, accountId: string, connected: boolean): void;
/** Update non-secret metadata while preserving encrypted fields byte-for-byte. */
export declare function storeAccount(_projectId: string, account: EmailAccount): void;
/**
 * Bootstrap the fingerprint for pre-guard encrypted records only after every
 * encrypted field decrypts with the currently configured key. Failed or legacy
 * plaintext records remain untouched and mail degrades safely.
 */
export declare function establishEmailEncryptionKeyContinuity(): EmailEncryptionDiagnostics;
//# sourceMappingURL=accounts.d.ts.map