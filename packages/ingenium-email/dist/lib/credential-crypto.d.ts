/**
 * Return the AES-256 key material without ever persisting the source secret.
 * Keeping normalization here ensures encryption and the continuity fingerprint
 * are derived from exactly the same key bytes.
 */
export declare function getEmailEncryptionKey(): Buffer;
/** A non-reversible marker used only to detect encryption-key continuity. */
export declare function getEmailEncryptionKeyFingerprint(): string;
/** Encrypt string data with AES-256-GCM using a fresh IV for every value. */
export declare function encryptCredentialValue(data: string): string;
/** Decrypt an AES-256-GCM credential value. Authentication failures throw. */
export declare function decryptCredentialValue(encrypted: string): string;
//# sourceMappingURL=credential-crypto.d.ts.map