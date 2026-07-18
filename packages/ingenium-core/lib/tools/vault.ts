import { createHmac, randomInt, randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import {
  decryptSecret,
  deriveKey,
  encryptSecret,
  generateDEK,
  generateSalt,
  unwrapKey,
  verifyHMAC,
  wrapKey,
} from "./vault-crypto.js";

const VERIFY_DATA = Buffer.from("ingenium-vault-v1");
const DELETED_POLICY = '{"mode":"deleted"}';

let masterKey: Buffer | null = null;

type VaultItemMetadata = {
  id: string;
  name: string;
  type: string;
  folderId: string | null;
  tags: string;
  urls: string;
  username: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  access_count: number;
};

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./data";
}

function vaultConfigExists(): boolean {
  return !!getDb(dbPath()).prepare("SELECT 1 FROM vault_config WHERE id = 1").get();
}

function getMasterKey(): Buffer {
  if (!masterKey) throw new Error("Vault is sealed");
  return masterKey;
}

function insertAudit(
  projectId: string,
  eventType: string,
  itemId: string | null,
  actor: string,
  details: object,
): void {
  const db = getDb(dbPath());
  db.prepare(
    `INSERT INTO vault_audit_log (project_id, event_type, item_id, actor, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(projectId, eventType, itemId, actor, JSON.stringify(details), new Date().toISOString());
}

function toMetadata(row: Record<string, unknown>): VaultItemMetadata {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as string,
    folderId: (row.folder_id as string | null) ?? null,
    tags: (row.tags as string) ?? "[]",
    urls: (row.urls as string) ?? "[]",
    username: (row.username as string | null) ?? null,
    version: row.version as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    last_accessed_at: (row.last_accessed_at as string | null) ?? null,
    access_count: row.access_count as number,
  };
}

/** Create the singleton vault configuration if it does not already exist. */
export function initVault(_projectId: string, passphrase: string): void {
  const salt = generateSalt();
  const key = deriveKey(passphrase, salt);
  const verifyTag = createHmac("sha256", key).update(VERIFY_DATA).digest();
  key.fill(0);

  execTransaction(() => {
    const db = getDb(dbPath());
    db.prepare(
      `INSERT OR IGNORE INTO vault_config
       (id, sealed, master_key_salt, master_key_verify, scrypt_N, scrypt_r, scrypt_p)
       VALUES (1, 1, ?, ?, 16384, 8, 1)`,
    ).run(salt, verifyTag);
  });
  checkpointAfterWrite();
}

/** Initialize and unseal a new vault after validating the requested passphrase. */
export function initializeVault(projectId: string, passphrase: string, confirmation: string): { ok: boolean; error?: string } {
  if (vaultConfigExists()) return { ok: false, error: "Vault is already initialized" };
  if (passphrase !== confirmation) return { ok: false, error: "Passphrases do not match" };
  if (passphrase.length < 12) return { ok: false, error: "Passphrase must be at least 12 characters" };

  initVault(projectId, passphrase);
  const result = unsealVault(projectId, passphrase);
  if (!result.ok && masterKey) {
    masterKey.fill(0);
    masterKey = null;
  }
  return result;
}

/** Verify a passphrase and retain the derived vault key only in process memory. */
export function unsealVault(projectId: string, passphrase: string): { ok: boolean; error?: string } {
  const db = getDb(dbPath());
  const config = db.prepare(
    "SELECT master_key_salt, master_key_verify, scrypt_N, scrypt_r, scrypt_p FROM vault_config WHERE id = 1",
  ).get() as {
    master_key_salt: Buffer;
    master_key_verify: Buffer;
    scrypt_N: number;
    scrypt_r: number;
    scrypt_p: number;
  } | undefined;

  if (!config) return { ok: false, error: "Vault is not initialized" };

  const key = deriveKey(passphrase, config.master_key_salt, {
    N: config.scrypt_N,
    r: config.scrypt_r,
    p: config.scrypt_p,
  });

  if (!verifyHMAC(key, VERIFY_DATA, config.master_key_verify)) {
    key.fill(0);
    logAudit(projectId, "vault_unseal_failed", null, "system", {});
    return { ok: false, error: "Invalid passphrase" };
  }

  if (masterKey) masterKey.fill(0);
  masterKey = key;
  execTransaction(() => {
    getDb(dbPath()).prepare("UPDATE vault_config SET sealed = 0, updated_at = ? WHERE id = 1")
      .run(new Date().toISOString());
    insertAudit(projectId, "vault_unsealed", null, "system", {});
  });
  checkpointAfterWrite();
  return { ok: true };
}

/** Zero the in-memory key and mark the vault sealed without altering stored secrets. */
export function sealVault(): void {
  if (masterKey) masterKey.fill(0);
  masterKey = null;
  execTransaction(() => {
    getDb(dbPath()).prepare("UPDATE vault_config SET sealed = 1, updated_at = ? WHERE id = 1")
      .run(new Date().toISOString());
  });
  checkpointAfterWrite();
}

/** Return whether this process currently holds an unsealed vault key. */
export function isSealed(): boolean {
  return masterKey === null;
}

/** Encrypt and store a vault item with a unique data encryption key. */
export function createItem(
  projectId: string,
  name: string,
  type: string,
  value: string,
  folderId?: string,
  tags?: string[],
  urls?: string[],
  username?: string,
): string {
  if (isSealed()) return "Vault is sealed";
  const dek = generateDEK();
  const key = getMasterKey();
  const encrypted = encryptSecret(value, dek);
  const wrappedDek = wrapKey(dek, key);
  dek.fill(0);
  const id = randomUUID();

  execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO vault_items
       (id, project_id, folder_id, name, type, tags, urls, username, encrypted, wrapped_kek, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, projectId, folderId ?? null, name, type, JSON.stringify(tags ?? []), JSON.stringify(urls ?? []), username ?? null, encrypted, wrappedDek, now, now);
    insertAudit(projectId, "secret_created", id, "system", { name, type });
  });
  checkpointAfterWrite();
  return id;
}

/** Return non-sensitive metadata for one active vault item. */
export function getItemMetadata(projectId: string, itemId: string): object | null {
  if (isSealed()) return null;
  const row = getDb(dbPath()).prepare(
    `SELECT id, name, type, folder_id, tags, urls, username, version, created_at, updated_at, last_accessed_at, access_count
     FROM vault_items WHERE project_id = ? AND id = ? AND access_policy <> ?`,
  ).get(projectId, itemId, DELETED_POLICY) as Record<string, unknown> | undefined;
  return row ? toMetadata(row) : null;
}

/** Decrypt a vault item and update its access metadata. */
export function decryptItem(projectId: string, itemId: string): string | null {
  let key: Buffer;
  try {
    key = getMasterKey();
  } catch {
    return null;
  }
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const item = db.prepare(
      "SELECT encrypted, wrapped_kek FROM vault_items WHERE project_id = ? AND id = ? AND access_policy <> ?",
    ).get(projectId, itemId, DELETED_POLICY) as { encrypted: Buffer; wrapped_kek: Buffer } | undefined;
    if (!item) return null;

    const dek = unwrapKey(item.wrapped_kek, key);
    try {
      const plaintext = decryptSecret(item.encrypted, dek).toString("utf8");
      const now = new Date().toISOString();
      db.prepare(
        "UPDATE vault_items SET last_accessed_at = ?, access_count = access_count + 1 WHERE project_id = ? AND id = ?",
      ).run(now, projectId, itemId);
      insertAudit(projectId, "secret_read", itemId, "system", {});
      return plaintext;
    } finally {
      dek.fill(0);
    }
  });
  if (result !== null) checkpointAfterWrite();
  return result;
}

/** List non-sensitive metadata for active items in a project or folder. */
export function listItems(projectId: string, folderId?: string): object[] {
  if (isSealed()) return [];
  const db = getDb(dbPath());
  const rows = folderId === undefined
    ? db.prepare(
      `SELECT id, name, type, folder_id, tags, urls, username, version, created_at, updated_at, last_accessed_at, access_count
       FROM vault_items WHERE project_id = ? AND access_policy <> ? ORDER BY name`,
    ).all(projectId, DELETED_POLICY)
    : db.prepare(
      `SELECT id, name, type, folder_id, tags, urls, username, version, created_at, updated_at, last_accessed_at, access_count
       FROM vault_items WHERE project_id = ? AND folder_id = ? AND access_policy <> ? ORDER BY name`,
    ).all(projectId, folderId, DELETED_POLICY);
  return (rows as Record<string, unknown>[]).map(toMetadata);
}

/** Re-encrypt an active vault item under a fresh data encryption key. */
export function updateItem(projectId: string, itemId: string, value: string): void {
  if (isSealed()) return;
  const dek = generateDEK();
  const key = getMasterKey();
  const encrypted = encryptSecret(value, dek);
  const wrappedDek = wrapKey(dek, key);
  dek.fill(0);

  execTransaction(() => {
    const db = getDb(dbPath());
    const changed = db.prepare(
      `UPDATE vault_items
       SET encrypted = ?, wrapped_kek = ?, version = version + 1, updated_at = ?
       WHERE project_id = ? AND id = ? AND access_policy <> ?`,
    ).run(encrypted, wrappedDek, new Date().toISOString(), projectId, itemId, DELETED_POLICY);
    if (changed.changes > 0) insertAudit(projectId, "secret_updated", itemId, "system", {});
  });
  checkpointAfterWrite();
}

/** Update non-sensitive metadata for an active vault item. */
export function updateItemMetadata(
  projectId: string,
  itemId: string,
  updates: {
    name?: string;
    type?: string;
    folderId?: string | null;
    tags?: string[];
    urls?: string[];
    username?: string | null;
  },
): boolean {
  if (isSealed()) return false;

  const fields: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };

  if (updates.name !== undefined) add("name", updates.name);
  if (updates.type !== undefined) add("type", updates.type);
  if (updates.folderId !== undefined) add("folder_id", updates.folderId);
  if (updates.tags !== undefined) add("tags", JSON.stringify(updates.tags));
  if (updates.urls !== undefined) add("urls", JSON.stringify(updates.urls));
  if (updates.username !== undefined) add("username", updates.username);
  if (fields.length === 0) return getItemMetadata(projectId, itemId) !== null;

  let changed = false;
  execTransaction(() => {
    const result = getDb(dbPath()).prepare(
      `UPDATE vault_items
       SET ${fields.join(", ")}, updated_at = ?
       WHERE project_id = ? AND id = ? AND access_policy <> ?`,
    ).run(...values, new Date().toISOString(), projectId, itemId, DELETED_POLICY);
    changed = result.changes > 0;
    if (changed) insertAudit(projectId, "secret_updated", itemId, "system", {});
  });
  checkpointAfterWrite();
  return changed;
}

/** Soft-delete an item by transitioning it to an inaccessible policy state. */
export function deleteItem(projectId: string, itemId: string): void {
  if (isSealed()) return;
  execTransaction(() => {
    const db = getDb(dbPath());
    const changed = db.prepare(
      "UPDATE vault_items SET access_policy = ?, updated_at = ? WHERE project_id = ? AND id = ? AND access_policy <> ?",
    ).run(DELETED_POLICY, new Date().toISOString(), projectId, itemId, DELETED_POLICY);
    if (changed.changes > 0) insertAudit(projectId, "secret_deleted", itemId, "system", {});
  });
  checkpointAfterWrite();
}

/** Persist an auditable vault event. */
export function logAudit(
  projectId: string,
  eventType: string,
  itemId: string | null,
  actor: string,
  details: object,
): void {
  execTransaction(() => insertAudit(projectId, eventType, itemId, actor, details));
  checkpointAfterWrite();
}

/** Generate a cryptographically secure password from a broad printable alphabet. */
export function generatePassword(length = 24): string {
  if (!Number.isSafeInteger(length) || length < 4) throw new Error("Password length must be at least 4");
  const groups = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%^&*_-+=",
  ];
  const alphabet = groups.join("");
  const chars = groups.map((group) => group[randomInt(group.length)]!);
  while (chars.length < length) chars.push(alphabet[randomInt(alphabet.length)]!);

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}
