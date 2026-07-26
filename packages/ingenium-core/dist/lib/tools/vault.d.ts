/** Create the singleton vault configuration if it does not already exist. */
export declare function initVault(_projectId: string, passphrase: string): void;
/** Initialize and unseal a new vault after validating the requested passphrase. */
export declare function initializeVault(projectId: string, passphrase: string, confirmation: string): {
    ok: boolean;
    error?: string;
};
/** Verify a passphrase and retain the derived vault key only in process memory. */
export declare function unsealVault(projectId: string, passphrase: string): {
    ok: boolean;
    error?: string;
};
/** Zero the in-memory key and mark the vault sealed without altering stored secrets. */
export declare function sealVault(): void;
/** Return whether this process currently holds an unsealed vault key. */
export declare function isSealed(): boolean;
/** Encrypt and store a vault item with a unique data encryption key. */
export declare function createItem(projectId: string, name: string, type: string, value: string, folderId?: string, tags?: string[], urls?: string[], username?: string): string;
/** Return non-sensitive metadata for one active vault item. */
export declare function getItemMetadata(projectId: string, itemId: string): object | null;
/** Decrypt a vault item and update its access metadata. */
export declare function decryptItem(projectId: string, itemId: string): string | null;
/** List non-sensitive metadata for active items in a project or folder. */
export declare function listItems(projectId: string, folderId?: string): object[];
/** Re-encrypt an active vault item under a fresh data encryption key. */
export declare function updateItem(projectId: string, itemId: string, value: string): void;
/** Update non-sensitive metadata for an active vault item. */
export declare function updateItemMetadata(projectId: string, itemId: string, updates: {
    name?: string;
    type?: string;
    folderId?: string | null;
    tags?: string[];
    urls?: string[];
    username?: string | null;
}): boolean;
/** Soft-delete an item by transitioning it to an inaccessible policy state. */
export declare function deleteItem(projectId: string, itemId: string): void;
/** Persist an auditable vault event. */
export declare function logAudit(projectId: string, eventType: string, itemId: string | null, actor: string, details: object): void;
/** Generate a cryptographically secure password from a broad printable alphabet. */
export declare function generatePassword(length?: number): string;
//# sourceMappingURL=vault.d.ts.map