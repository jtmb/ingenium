import { createHmac, randomInt, randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import {
  decryptSecret,
  decryptSecretBuffer,
  deriveKey,
  encryptSecret,
  generateDEK,
  generateSalt,
  unwrapKey,
  verifyHMAC,
  wrapKey,
} from "./vault-crypto.js";
import { migrateLegacyOAuthClientSecretsForActiveGlobalProject } from "./protected-settings.js";
import { insertJobVaultRuntimeAudit } from "./jobs.js";
import { insertResourceAuditEvent } from "./authorization.js";

const VERIFY_DATA = Buffer.from("ingenium-vault-v1");
const DELETED_POLICY = '{"mode":"deleted"}';

/** Minimum number of Unicode code points required when creating a vault. */
export const VAULT_PASSPHRASE_MIN_LENGTH = 12;

let masterKey: Buffer | null = null;

export class VaultJobSecretsUnavailableError extends Error {
  readonly code = "VAULT_SECRETS_UNAVAILABLE" as const;

  constructor() {
    super("VAULT_SECRETS_UNAVAILABLE");
    this.name = "VaultJobSecretsUnavailableError";
  }
}

/** A run-owned plaintext buffer. Call release after the bounded runner tears down. */
export interface VaultJobSecretHandle {
  readonly itemId: string;
  readonly authorizedItemVersion: number;
  readonly value: Buffer;
  release(): void;
}

/** Execution-only vault material. It is never suitable for API or MCP responses. */
export interface VaultJobSecretsResolution {
  readonly secrets: readonly VaultJobSecretHandle[];
  readonly deadlineAt: number;
  release(): void;
}

type VaultJobSecretBufferObserver = (kind: "dek" | "plaintext", buffer: Buffer) => void;
let vaultJobSecretBufferObserver: VaultJobSecretBufferObserver | undefined;

/** Test-only seam proving transient resolver buffers are zeroed before release returns. */
export function configureVaultJobSecretBufferObserverForTesting(
  observer?: VaultJobSecretBufferObserver,
): () => void {
  const previous = vaultJobSecretBufferObserver;
  vaultJobSecretBufferObserver = observer;
  return () => {
    vaultJobSecretBufferObserver = previous;
  };
}

function zeroJobSecretBuffer(kind: "dek" | "plaintext", buffer: Buffer): void {
  buffer.fill(0);
  vaultJobSecretBufferObserver?.(kind, buffer);
}

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
  organizationId: string;
  ownerKind: "user" | "organization";
  ownerUserId: string | null;
};

export interface VaultActor {
  type: "compatibility" | "user" | "service" | "system";
  id?: string | null;
  requestId?: string | null;
}

export interface VaultOwnership {
  organizationId: string;
  ownerKind: "user" | "organization";
  ownerUserId?: string | null;
}

const SYSTEM_ACTOR: VaultActor = { type: "system" };

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

/**
 * Validate a passphrase only when creating a new vault. Existing vaults are
 * intentionally not revalidated during unseal so an upgrade cannot lock out a
 * previously valid vault. This is the policy used by dashboard initialization,
 * core initialization, and MCP's first-use initialization path.
 */
export function validateVaultPassphrase(passphrase: string): { ok: true } | { ok: false; error: string } {
  if (passphrase.trim().length === 0) {
    return { ok: false, error: "Passphrase must not be blank" };
  }
  if (Array.from(passphrase).length < VAULT_PASSPHRASE_MIN_LENGTH) {
    return { ok: false, error: `Passphrase must be at least ${VAULT_PASSPHRASE_MIN_LENGTH} characters` };
  }
  return { ok: true };
}

function insertAudit(
  projectId: string,
  eventType: string,
  itemId: string | null,
  actor: VaultActor,
  details: object,
): void {
  const db = getDb(dbPath());
  const project = db.prepare("SELECT organization_id FROM projects WHERE id = ?").get(projectId) as { organization_id: string } | undefined;
  if (!project) return;
  const sourceAuditEventId = insertResourceAuditEvent({
    organizationId: project.organization_id,
    projectId,
    resourceType: itemId ? "vault_item" : "vault",
    resourceId: itemId,
    action: eventType,
    actorType: actor.type,
    actorId: actor.id,
    outcome: "success",
    requestId: actor.requestId,
  });
  db.prepare(
    `INSERT INTO vault_audit_log
       (project_id, organization_id, event_type, item_id, actor, actor_type, actor_id, request_id, source_audit_event_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  ).run(projectId, project.organization_id, eventType, itemId, actor.id ?? actor.type, actor.type, actor.id ?? null,
    actor.requestId ?? null, sourceAuditEventId, JSON.stringify(details), new Date().toISOString());
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
    organizationId: row.organization_id as string,
    ownerKind: row.owner_kind as "user" | "organization",
    ownerUserId: (row.owner_user_id as string | null) ?? null,
  };
}

/**
 * Create the singleton vault configuration if it does not already exist.
 *
 * The master-key configuration belongs to the service-wide vault. Vault items,
 * folders, and audit records remain isolated by the supplied project ID.
 */
export function initVault(_projectId: string, passphrase: string): void {
  const validation = validateVaultPassphrase(passphrase);
  if (!validation.ok) throw new Error(validation.error);

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
  const validation = validateVaultPassphrase(passphrase);
  if (!validation.ok) return validation;

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
    logAudit(projectId, "vault_unseal_failed", null, SYSTEM_ACTOR, {});
    return { ok: false, error: "Invalid passphrase" };
  }

  if (masterKey) masterKey.fill(0);
  masterKey = key;
  execTransaction(() => {
    getDb(dbPath()).prepare("UPDATE vault_config SET sealed = 0, updated_at = ? WHERE id = 1")
      .run(new Date().toISOString());
    insertAudit(projectId, "vault_unsealed", null, SYSTEM_ACTOR, {});
  });
  checkpointAfterWrite();
  // This is deliberately post-commit: legacy values are migrated only after
  // the vault is durably unsealed, and a safe migration failure never changes
  // a successful vault-unseal response.
  migrateLegacyOAuthClientSecretsForActiveGlobalProject();
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

function unavailableJobSecrets(): never {
  throw new VaultJobSecretsUnavailableError();
}

function recordJobSecretDenied(projectId: string, jobId: string, runId: string): void {
  let recorded = false;
  try {
    recorded = execTransaction(() => {
      const db = getDb(dbPath());
      const activeProject = db.prepare(
        "SELECT 1 FROM projects WHERE id = ? AND archived_at IS NULL",
      ).get(projectId);
      if (!activeProject) return false;
      return insertJobVaultRuntimeAudit(db, {
        projectId,
        jobId,
        runId,
        action: "access_denied",
      });
    });
  } catch {
    // A failing audit must not expose the authorization cause or prevent the
    // execution boundary from failing closed.
  }
  if (recorded) checkpointAfterWrite();
}

function jobTimeoutDeadline(nowMs: number, timeoutMinutes: number): number | null {
  const minutes = Number.isSafeInteger(timeoutMinutes) && timeoutMinutes > 0 ? timeoutMinutes : 30;
  const deadline = nowMs + minutes * 60_000;
  return Number.isSafeInteger(deadline) ? deadline : null;
}

/**
 * Resolve secrets for one already-created run immediately before process spawn.
 * This is deliberately execution-only: callers receive mutable Buffers that
 * must be released after use and no authorization detail is returned on error.
 */
export function resolveJobVaultSecrets(
  projectId: string,
  jobId: string,
  runId: string,
): VaultJobSecretsResolution | null {
  const db = getDb(dbPath());
  const candidate = db.prepare(
    `SELECT count(reference.item_id) AS reference_count
     FROM projects project
     JOIN jobs job ON job.project_id = project.id
     JOIN job_runs run ON run.project_id = job.project_id AND run.job_id = job.id AND run.id = ?
     LEFT JOIN job_vault_references reference
       ON reference.project_id = job.project_id AND reference.job_id = job.id
     WHERE project.id = ? AND project.archived_at IS NULL
       AND job.id = ? AND job.enabled = 1 AND job.deleted_at IS NULL
     GROUP BY job.id`,
   ).get(runId, projectId, jobId) as { reference_count: number } | undefined;

  if (!candidate) unavailableJobSecrets();
  if (candidate.reference_count === 0) return null;

  const key = masterKey;
  if (!key) {
    recordJobSecretDenied(projectId, jobId, runId);
    unavailableJobSecrets();
  }

  const handles: VaultJobSecretHandle[] = [];
  const release = () => {
    for (const handle of handles) handle.release();
  };

  try {
    const result = execTransaction(() => {
      const transactionDb = getDb(dbPath());
      const job = transactionDb.prepare(
        `SELECT job.timeout_minutes, config.sealed, count(all_reference.item_id) AS reference_count
          FROM projects project
          JOIN jobs job ON job.project_id = project.id
          JOIN job_runs run ON run.project_id = job.project_id AND run.job_id = job.id AND run.id = ?
          JOIN vault_config config ON config.id = 1
         LEFT JOIN job_vault_references all_reference
           ON all_reference.project_id = job.project_id AND all_reference.job_id = job.id
         WHERE project.id = ? AND project.archived_at IS NULL
           AND job.id = ? AND job.enabled = 1 AND job.deleted_at IS NULL
         GROUP BY job.id, config.sealed`,
       ).get(runId, projectId, jobId) as {
        timeout_minutes: number;
        sealed: number;
        reference_count: number;
      } | undefined;
      if (!job || job.sealed !== 0 || job.reference_count === 0) unavailableJobSecrets();

      const references = transactionDb.prepare(
        `SELECT reference.item_id, reference.authorized_item_version,
                item.id AS active_item_id, item.version, item.access_policy,
                item.expires_at, item.lease_duration_seconds, item.encrypted, item.wrapped_kek
         FROM job_vault_references reference
         LEFT JOIN vault_items item
           ON item.project_id = reference.project_id AND item.id = reference.item_id
         WHERE reference.project_id = ? AND reference.job_id = ? AND reference.status = 'authorized'
         ORDER BY reference.item_id ASC`,
      ).all(projectId, jobId) as Array<{
        item_id: string;
        authorized_item_version: number;
        active_item_id: string | null;
        version: number | null;
        access_policy: string | null;
        expires_at: string | null;
        lease_duration_seconds: number | null;
        encrypted: Buffer | null;
        wrapped_kek: Buffer | null;
      }>;
      if (references.length === 0) unavailableJobSecrets();

      const nowMs = Date.now();
      let deadlineAt = jobTimeoutDeadline(nowMs, job.timeout_minutes);
      if (deadlineAt === null) unavailableJobSecrets();

      for (const reference of references) {
        if (
          reference.active_item_id !== reference.item_id
          || reference.access_policy === DELETED_POLICY
          || reference.version !== reference.authorized_item_version
          || !reference.encrypted
          || !reference.wrapped_kek
        ) {
          unavailableJobSecrets();
        }

        if (reference.expires_at !== null) {
          const expiresAt = Date.parse(reference.expires_at);
          if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowMs) unavailableJobSecrets();
          deadlineAt = Math.min(deadlineAt, expiresAt);
        }
        if (reference.lease_duration_seconds !== null) {
          if (!Number.isSafeInteger(reference.lease_duration_seconds) || reference.lease_duration_seconds <= 0) {
            unavailableJobSecrets();
          }
          const leaseDeadline = nowMs + reference.lease_duration_seconds * 1_000;
          if (!Number.isSafeInteger(leaseDeadline)) unavailableJobSecrets();
          deadlineAt = Math.min(deadlineAt, leaseDeadline);
        }

        let dek: Buffer | undefined;
        let plaintext: Buffer | undefined;
        try {
          dek = unwrapKey(reference.wrapped_kek, key);
          plaintext = decryptSecretBuffer(reference.encrypted, dek);
          let released = false;
          const value = plaintext;
          handles.push({
            itemId: reference.item_id,
            authorizedItemVersion: reference.authorized_item_version,
            value,
            release: () => {
              if (released) return;
              released = true;
              zeroJobSecretBuffer("plaintext", value);
            },
          });
          plaintext = undefined;
        } finally {
          if (plaintext) zeroJobSecretBuffer("plaintext", plaintext);
          if (dek) zeroJobSecretBuffer("dek", dek);
        }

        const accessTime = new Date().toISOString();
        transactionDb.prepare(
          "UPDATE vault_items SET last_accessed_at = ?, access_count = access_count + 1 WHERE project_id = ? AND id = ? AND version = ? AND access_policy <> ?",
        ).run(accessTime, projectId, reference.item_id, reference.version, DELETED_POLICY);
        if (!insertJobVaultRuntimeAudit(transactionDb, {
          projectId,
          jobId,
          runId,
          action: "secret_read",
          itemId: reference.item_id,
          authorizedItemVersion: reference.authorized_item_version,
        })) unavailableJobSecrets();
      }

      return deadlineAt;
    });
    checkpointAfterWrite();
    return { secrets: handles, deadlineAt: result, release };
  } catch {
    release();
    recordJobSecretDenied(projectId, jobId, runId);
    unavailableJobSecrets();
  }
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
  ownership?: VaultOwnership,
  actor: VaultActor = SYSTEM_ACTOR,
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
       (id, project_id, organization_id, owner_kind, owner_user_id, folder_id, name, type, tags, urls, username,
        encrypted, wrapped_kek, created_by_actor_type, created_by_actor_id, created_at, updated_at)
       SELECT ?, id, COALESCE(?, organization_id), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM projects WHERE id = ?`,
    ).run(id, ownership?.organizationId ?? null, ownership?.ownerKind ?? "organization",
      ownership?.ownerKind === "user" ? ownership.ownerUserId ?? actor.id ?? null : null,
      folderId ?? null, name, type, JSON.stringify(tags ?? []), JSON.stringify(urls ?? []), username ?? null,
      encrypted, wrappedDek, actor.type, actor.id ?? null, now, now, projectId);
    // Audit events intentionally contain no user-controlled metadata or secret
    // material. The item ID is sufficient to correlate an audited operation.
    insertAudit(projectId, "secret_created", id, actor, {});
  });
  checkpointAfterWrite();
  return id;
}

/** Return non-sensitive metadata for one active vault item. */
export function getItemMetadata(projectId: string, itemId: string): object | null {
  if (isSealed()) return null;
  const row = getDb(dbPath()).prepare(
     `SELECT id, name, type, folder_id, tags, urls, username, version, created_at, updated_at, last_accessed_at, access_count,
             organization_id, owner_kind, owner_user_id
     FROM vault_items WHERE project_id = ? AND id = ? AND access_policy <> ?`,
  ).get(projectId, itemId, DELETED_POLICY) as Record<string, unknown> | undefined;
  return row ? toMetadata(row) : null;
}

/** Decrypt a vault item and update its access metadata. */
export function decryptItem(projectId: string, itemId: string, actor: VaultActor = SYSTEM_ACTOR): string | null {
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
      const plaintextBuffer = decryptSecret(item.encrypted, dek);
      let plaintext: string;
      try {
        plaintext = plaintextBuffer.toString("utf8");
      } finally {
        plaintextBuffer.fill(0);
      }
      const now = new Date().toISOString();
      db.prepare(
        "UPDATE vault_items SET last_accessed_at = ?, access_count = access_count + 1 WHERE project_id = ? AND id = ?",
      ).run(now, projectId, itemId);
      insertAudit(projectId, "secret_read", itemId, actor, {});
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
       `SELECT id, name, type, folder_id, tags, urls, username, version, created_at, updated_at, last_accessed_at, access_count,
               organization_id, owner_kind, owner_user_id
       FROM vault_items WHERE project_id = ? AND access_policy <> ? ORDER BY name`,
    ).all(projectId, DELETED_POLICY)
    : db.prepare(
       `SELECT id, name, type, folder_id, tags, urls, username, version, created_at, updated_at, last_accessed_at, access_count,
               organization_id, owner_kind, owner_user_id
       FROM vault_items WHERE project_id = ? AND folder_id = ? AND access_policy <> ? ORDER BY name`,
    ).all(projectId, folderId, DELETED_POLICY);
  return (rows as Record<string, unknown>[]).map(toMetadata);
}

/** Re-encrypt an active vault item under a fresh data encryption key. */
export function updateItem(projectId: string, itemId: string, value: string, actor: VaultActor = SYSTEM_ACTOR): void {
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
    if (changed.changes > 0) insertAudit(projectId, "secret_updated", itemId, actor, {});
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
  actor: VaultActor = SYSTEM_ACTOR,
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
    if (changed) insertAudit(projectId, "secret_updated", itemId, actor, {});
  });
  checkpointAfterWrite();
  return changed;
}

/** Soft-delete an item by transitioning it to an inaccessible policy state. */
export function deleteItem(projectId: string, itemId: string, actor: VaultActor = SYSTEM_ACTOR): void {
  // Soft deletion only changes metadata and does not need the master key.
  execTransaction(() => {
    const db = getDb(dbPath());
    const changed = db.prepare(
      "UPDATE vault_items SET access_policy = ?, updated_at = ? WHERE project_id = ? AND id = ? AND access_policy <> ?",
    ).run(DELETED_POLICY, new Date().toISOString(), projectId, itemId, DELETED_POLICY);
    if (changed.changes > 0) insertAudit(projectId, "secret_deleted", itemId, actor, {});
  });
  checkpointAfterWrite();
}

/** Persist an auditable vault event. */
export function logAudit(
  projectId: string,
  eventType: string,
  itemId: string | null,
  actor: VaultActor | string,
  _details: object,
): void {
  // Keep the persistent audit trail metadata-only even if a future caller
  // accidentally supplies sensitive detail data.
  execTransaction(() => insertAudit(projectId, eventType, itemId,
    typeof actor === "string" ? { type: actor === "system" ? "system" : "compatibility", id: actor } : actor, {}));
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
