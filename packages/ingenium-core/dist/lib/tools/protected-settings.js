import { randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import { logger } from "../logger.js";
import { getGlobalProject } from "./projects.js";
import * as vault from "./vault.js";
export const OAUTH_CLIENT_SECRET_KEYS = [
    "oauth_gmail_client_secret",
    "oauth_outlook_client_secret",
];
const DELETED_POLICY = '{"mode":"deleted"}';
function dbPath() {
    return process.env.INGENIUM_CORE_DB_PATH ?? "./data";
}
export function isOAuthClientSecretKey(value) {
    return typeof value === "string" && OAUTH_CLIENT_SECRET_KEYS.includes(value);
}
/**
 * OAuth application secrets are server-wide mail infrastructure. Resolve the
 * caller supplied project ID against the sole active global project rather
 * than treating an arbitrary dashboard project as a credential namespace.
 */
function isActiveGlobalProjectId(projectId) {
    try {
        return getGlobalProject()?.id === projectId;
    }
    catch {
        // An ambiguous or unavailable global project is an integrity failure. The
        // caller must fail closed instead of selecting a project by convention.
        return false;
    }
}
function vaultItemName(key) {
    return key === "oauth_gmail_client_secret"
        ? "OAuth Client Secret: Gmail"
        : "OAuth Client Secret: Outlook";
}
function nextVaultItemName(projectId, key) {
    const name = vaultItemName(key);
    const existing = getDb(dbPath()).prepare("SELECT 1 FROM vault_items WHERE project_id = ? AND name = ?").get(projectId, name);
    // Vault deletion is intentionally soft. A unique suffix permits an explicit
    // clear followed by replace without reusing a deleted vault row.
    return existing ? `${name} (${randomUUID()})` : name;
}
function getReference(projectId, key) {
    return getDb(dbPath()).prepare(`SELECT ps.vault_item_id
     FROM protected_settings ps
     INNER JOIN vault_items vi ON vi.id = ps.vault_item_id
     WHERE ps.project_id = ? AND ps.key = ? AND vi.project_id = ? AND vi.access_policy <> ?`).get(projectId, key, projectId, DELETED_POLICY);
}
/** A soft-deleted item has no usable secret and may leave a stale mapping after an interrupted clear. */
function getInactiveReference(projectId, key) {
    return getDb(dbPath()).prepare(`SELECT ps.vault_item_id
     FROM protected_settings ps
     INNER JOIN vault_items vi ON vi.id = ps.vault_item_id
     WHERE ps.project_id = ? AND ps.key = ? AND vi.project_id = ? AND vi.access_policy = ?`).get(projectId, key, projectId, DELETED_POLICY);
}
function removeInactiveReference(projectId, key) {
    const inactive = getInactiveReference(projectId, key);
    if (!inactive)
        return true;
    try {
        execTransaction(() => {
            getDb(dbPath()).prepare("DELETE FROM protected_settings WHERE project_id = ? AND key = ? AND vault_item_id = ?").run(projectId, key, inactive.vault_item_id);
        });
        checkpointAfterWrite();
        return true;
    }
    catch {
        return false;
    }
}
function getLegacyValue(projectId, key) {
    const row = getDb(dbPath()).prepare("SELECT value FROM settings WHERE project_id = ? AND key = ?").get(projectId, key);
    return row?.value;
}
function deleteLegacyValue(projectId, key) {
    execTransaction(() => {
        getDb(dbPath()).prepare("DELETE FROM settings WHERE project_id = ? AND key = ?")
            .run(projectId, key);
    });
    checkpointAfterWrite();
}
function metadata(projectId, key) {
    const isSet = Boolean(getReference(projectId, key) || getLegacyValue(projectId, key)?.trim());
    return { isSet, masked: isSet };
}
function emptyMetadata() {
    return { isSet: false, masked: false };
}
function protectedValueMatches(projectId, key, expected) {
    const reference = getReference(projectId, key);
    if (!reference)
        return false;
    try {
        return vault.decryptItem(projectId, reference.vault_item_id) === expected;
    }
    catch {
        return false;
    }
}
function writeProtectedValue(projectId, key, value) {
    if (vault.isSealed())
        return false;
    let createdItemId;
    try {
        const existing = getReference(projectId, key);
        if (existing) {
            if (!vault.getItemMetadata(projectId, existing.vault_item_id))
                return false;
            vault.updateItem(projectId, existing.vault_item_id, value);
            return protectedValueMatches(projectId, key, value);
        }
        if (!removeInactiveReference(projectId, key))
            return false;
        createdItemId = vault.createItem(projectId, nextVaultItemName(projectId, key), "oauth", value);
        if (!createdItemId || createdItemId === "Vault is sealed")
            return false;
        const mappingCreated = execTransaction(() => {
            const result = getDb(dbPath()).prepare(`INSERT INTO protected_settings (project_id, key, vault_item_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, key) DO NOTHING`).run(projectId, key, createdItemId, new Date().toISOString(), new Date().toISOString());
            return result.changes === 1;
        });
        checkpointAfterWrite();
        if (!mappingCreated) {
            // Another writer won the mapping race. This item is not referenced and
            // is safe to retire after the mapping transaction has committed.
            vault.deleteItem(projectId, createdItemId);
        }
        return protectedValueMatches(projectId, key, value);
    }
    catch {
        if (createdItemId) {
            try {
                vault.deleteItem(projectId, createdItemId);
            }
            catch {
                // The source value remains in settings; do not add sensitive details to logs.
            }
        }
        // Never expose storage, crypto, or database diagnostics through the
        // credential path. The legacy source remains untouched by the caller.
        return false;
    }
}
function clearProtectedValue(projectId, key) {
    if (vault.isSealed())
        return false;
    const existing = getReference(projectId, key);
    if (!existing) {
        try {
            if (!removeInactiveReference(projectId, key))
                return false;
            deleteLegacyValue(projectId, key);
            return true;
        }
        catch {
            return false;
        }
    }
    if (!vault.getItemMetadata(projectId, existing.vault_item_id))
        return false;
    try {
        vault.deleteItem(projectId, existing.vault_item_id);
        if (vault.getItemMetadata(projectId, existing.vault_item_id) !== null)
            return false;
        execTransaction(() => {
            getDb(dbPath()).prepare("DELETE FROM protected_settings WHERE project_id = ? AND key = ? AND vault_item_id = ?").run(projectId, key, existing.vault_item_id);
        });
        checkpointAfterWrite();
        deleteLegacyValue(projectId, key);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Migrate a historical plaintext OAuth client secret only after its encrypted
 * vault copy has been successfully created and verified. A mismatched existing
 * protected value is deliberately retained as an operator-visible conflict.
 */
export function migrateLegacyOAuthClientSecret(projectId, key) {
    if (!isActiveGlobalProjectId(projectId)) {
        return { status: "invalid", metadata: emptyMetadata() };
    }
    try {
        const legacy = getLegacyValue(projectId, key);
        if (!legacy?.trim())
            return { status: "ok", metadata: metadata(projectId, key) };
        if (vault.isSealed())
            return { status: "vault_unavailable", metadata: metadata(projectId, key) };
        const existing = getReference(projectId, key);
        if (existing) {
            const protectedValue = vault.decryptItem(projectId, existing.vault_item_id);
            if (protectedValue === null)
                return { status: "vault_unavailable", metadata: metadata(projectId, key) };
            if (protectedValue !== legacy)
                return { status: "legacy_conflict", metadata: metadata(projectId, key) };
            deleteLegacyValue(projectId, key);
            return { status: "ok", metadata: metadata(projectId, key) };
        }
        if (!writeProtectedValue(projectId, key, legacy)) {
            // A newly or concurrently mapped but non-matching destination is a
            // conflict, never an excuse to erase the plaintext source.
            const destination = getReference(projectId, key);
            if (destination && !protectedValueMatches(projectId, key, legacy)) {
                return { status: "legacy_conflict", metadata: metadata(projectId, key) };
            }
            return { status: "vault_unavailable", metadata: metadata(projectId, key) };
        }
        // Verify the value through the protected mapping after encryption and
        // before deleting the legacy plaintext row.
        if (!protectedValueMatches(projectId, key, legacy)) {
            return { status: "legacy_conflict", metadata: metadata(projectId, key) };
        }
        deleteLegacyValue(projectId, key);
        return { status: "ok", metadata: metadata(projectId, key) };
    }
    catch {
        // Fail closed. The source setting is only deleted after all validation
        // steps complete, so a storage or crypto failure preserves it for retry.
        return { status: "vault_unavailable", metadata: metadata(projectId, key) };
    }
}
/** Migrate both supported OAuth application client-secret settings. */
export function migrateLegacyOAuthClientSecrets(projectId) {
    return OAUTH_CLIENT_SECRET_KEYS.map((key) => migrateLegacyOAuthClientSecret(projectId, key));
}
/**
 * Reconcile legacy OAuth secrets only for the sole active global project.
 * Lifecycle callers use this after the vault opens; the log records outcomes
 * only and never project identifiers, keys, values, or error text.
 */
export function migrateLegacyOAuthClientSecretsForActiveGlobalProject() {
    try {
        const globalProject = getGlobalProject();
        if (!globalProject) {
            logger.warn("protected-settings", "OAuth client-secret migration skipped because no active global project is available");
            return { status: "no_active_global", results: [] };
        }
        const results = migrateLegacyOAuthClientSecrets(globalProject.id);
        const outcomes = results.reduce((counts, result) => {
            counts[result.status] += 1;
            return counts;
        }, { ok: 0, vault_unavailable: 0, legacy_conflict: 0, invalid: 0 });
        const level = outcomes.legacy_conflict || outcomes.vault_unavailable || outcomes.invalid ? "warn" : "info";
        logger[level]("protected-settings", "OAuth client-secret migration completed after vault unseal", { outcomes });
        return { status: "completed", results };
    }
    catch {
        logger.warn("protected-settings", "OAuth client-secret migration failed safely after vault unseal");
        return { status: "error", results: [] };
    }
}
/** Read the protected value for runtime use. Sealed/unavailable vaults fail closed. */
export function getOAuthClientSecret(projectId, key) {
    if (!isActiveGlobalProjectId(projectId))
        return undefined;
    if (vault.isSealed())
        return undefined;
    const reference = getReference(projectId, key);
    if (!reference)
        return undefined;
    try {
        return vault.decryptItem(projectId, reference.vault_item_id) ?? undefined;
    }
    catch {
        return undefined;
    }
}
/** Return non-sensitive state for API responses. */
export function getOAuthClientSecretMetadata(projectId, key) {
    if (!isActiveGlobalProjectId(projectId))
        return emptyMetadata();
    return metadata(projectId, key);
}
/**
 * Preserve leaves a saved secret untouched, replace writes a non-empty value,
 * and clear requires an explicit action. Values are never written to settings.
 */
export function updateOAuthClientSecret(projectId, key, action, value) {
    if (!isActiveGlobalProjectId(projectId)) {
        return { status: "invalid", metadata: emptyMetadata() };
    }
    if (action === "preserve")
        return migrateLegacyOAuthClientSecret(projectId, key);
    if (action === "replace") {
        if (!value?.trim())
            return { status: "invalid", metadata: metadata(projectId, key) };
        if (vault.isSealed() || !writeProtectedValue(projectId, key, value)) {
            return { status: "vault_unavailable", metadata: metadata(projectId, key) };
        }
        // Do not remove a plaintext compatibility value until the encrypted
        // destination can be decrypted through its protected mapping.
        if (!protectedValueMatches(projectId, key, value)) {
            return { status: "vault_unavailable", metadata: metadata(projectId, key) };
        }
        try {
            deleteLegacyValue(projectId, key);
            return { status: "ok", metadata: metadata(projectId, key) };
        }
        catch {
            return { status: "vault_unavailable", metadata: metadata(projectId, key) };
        }
    }
    if (action === "clear") {
        if (!clearProtectedValue(projectId, key)) {
            return { status: "vault_unavailable", metadata: metadata(projectId, key) };
        }
        return { status: "ok", metadata: metadata(projectId, key) };
    }
    return { status: "invalid", metadata: metadata(projectId, key) };
}
