/** Derive a 256-bit vault key from a passphrase using scrypt. */
export declare function deriveKey(passphrase: string, salt: Buffer, params?: {
    N?: number;
    r?: number;
    p?: number;
}): Buffer;
/** Encrypt plaintext with AES-256-GCM as IV || ciphertext || authentication tag. */
export declare function encryptSecret(plaintext: string, key: Buffer): Buffer;
/** Decrypt an AES-256-GCM payload encoded as IV || ciphertext || authentication tag. */
export declare function decryptSecret(ciphertext: Buffer, key: Buffer): Buffer;
/** Generate a random 256-bit data encryption key. */
export declare function generateDEK(): Buffer;
/** Wrap a data encryption key using AES-256-GCM. */
export declare function wrapKey(key: Buffer, wrappingKey: Buffer): Buffer;
/** Unwrap a data encryption key encrypted by wrapKey. */
export declare function unwrapKey(wrapped: Buffer, wrappingKey: Buffer): Buffer;
/** Generate a random 256-bit vault salt. */
export declare function generateSalt(): Buffer;
/** Verify a SHA-256 HMAC in constant time. */
export declare function verifyHMAC(key: Buffer, data: Buffer, tag: Buffer): boolean;
//# sourceMappingURL=vault-crypto.d.ts.map