export declare const OAUTH_CLIENT_SECRET_KEYS: readonly ["oauth_gmail_client_secret", "oauth_outlook_client_secret"];
export type OAuthClientSecretKey = (typeof OAUTH_CLIENT_SECRET_KEYS)[number];
export type OAuthClientSecretAction = "preserve" | "replace" | "clear";
export interface OAuthClientSecretMetadata {
    isSet: boolean;
    masked: boolean;
}
export type OAuthClientSecretResult = {
    status: "ok";
    metadata: OAuthClientSecretMetadata;
} | {
    status: "vault_unavailable";
    metadata: OAuthClientSecretMetadata;
} | {
    status: "legacy_conflict";
    metadata: OAuthClientSecretMetadata;
} | {
    status: "invalid";
    metadata: OAuthClientSecretMetadata;
};
export type OAuthClientSecretLifecycleMigration = {
    status: "completed";
    results: OAuthClientSecretResult[];
} | {
    status: "no_active_global";
    results: [];
} | {
    status: "error";
    results: [];
};
export declare function isOAuthClientSecretKey(value: unknown): value is OAuthClientSecretKey;
/**
 * Migrate a historical plaintext OAuth client secret only after its encrypted
 * vault copy has been successfully created and verified. A mismatched existing
 * protected value is deliberately retained as an operator-visible conflict.
 */
export declare function migrateLegacyOAuthClientSecret(projectId: string, key: OAuthClientSecretKey): OAuthClientSecretResult;
/** Migrate both supported OAuth application client-secret settings. */
export declare function migrateLegacyOAuthClientSecrets(projectId: string): OAuthClientSecretResult[];
/**
 * Reconcile legacy OAuth secrets only for the sole active global project.
 * Lifecycle callers use this after the vault opens; the log records outcomes
 * only and never project identifiers, keys, values, or error text.
 */
export declare function migrateLegacyOAuthClientSecretsForActiveGlobalProject(): OAuthClientSecretLifecycleMigration;
/** Read the protected value for runtime use. Sealed/unavailable vaults fail closed. */
export declare function getOAuthClientSecret(projectId: string, key: OAuthClientSecretKey): string | undefined;
/** Return non-sensitive state for API responses. */
export declare function getOAuthClientSecretMetadata(projectId: string, key: OAuthClientSecretKey): OAuthClientSecretMetadata;
/**
 * Preserve leaves a saved secret untouched, replace writes a non-empty value,
 * and clear requires an explicit action. Values are never written to settings.
 */
export declare function updateOAuthClientSecret(projectId: string, key: OAuthClientSecretKey, action: OAuthClientSecretAction, value?: string): OAuthClientSecretResult;
//# sourceMappingURL=protected-settings.d.ts.map