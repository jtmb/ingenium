import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { randomUUID } from "node:crypto";

/**
 * Maintenance lock entry — represents an atomic lease on a resource scoped to a project.
 *
 * Conflict rules:
 *   1. A project lock conflicts with an active global lock on the same resource.
 *   2. A global lock (`project_id = '*'`) conflicts with ANY active lock on the same resource.
 *   3. Same (resource, project_id) pair can only be held by one owner at a time (UNIQUE constraint).
 */
export interface MaintenanceLock {
  id: number;
  resource: string;
  project_id: string;
  owner_token: string;
  acquired_at: string;
  expires_at: string;
}

/** Maximum allowed length for resource and project_id strings. Mirrors SQL CHECK constraint. */
const MAX_RESOURCE_LEN = 256;
/** Maximum allowed length for owner_token strings. Mirrors SQL CHECK constraint. */
const MAX_TOKEN_LEN = 64;

/**
 * Validate lock inputs — throws on invalid input to catch programming errors early.
 * SQL CHECK constraints in migration 041 provide the DB-level enforcement.
 */
function validateLockInputs(resource: string, projectId: string, ownerToken: string): void {
  if (!resource || typeof resource !== "string" || resource.length === 0) {
    throw new TypeError("acquireLock: resource must be a non-empty string");
  }
  if (resource.length > MAX_RESOURCE_LEN) {
    throw new TypeError(`acquireLock: resource exceeds max length ${MAX_RESOURCE_LEN}`);
  }
  if (!projectId || typeof projectId !== "string" || projectId.length === 0) {
    throw new TypeError("acquireLock: projectId must be a non-empty string");
  }
  if (projectId.length > MAX_RESOURCE_LEN) {
    throw new TypeError(`acquireLock: projectId exceeds max length ${MAX_RESOURCE_LEN}`);
  }
  if (!ownerToken || typeof ownerToken !== "string" || ownerToken.length === 0) {
    throw new TypeError("acquireLock: ownerToken must be a non-empty string");
  }
  if (ownerToken.length > MAX_TOKEN_LEN) {
    throw new TypeError(`acquireLock: ownerToken exceeds max length ${MAX_TOKEN_LEN}`);
  }
}

/**
 * Validate ttlMs — must be a positive finite integer.
 */
function validateTtl(ttlMs: number): void {
  if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs < 1) {
    throw new TypeError(`acquireLock: ttlMs must be a positive finite number, got ${ttlMs}`);
  }
  if (ttlMs > Number.MAX_SAFE_INTEGER) {
    throw new TypeError(`acquireLock: ttlMs exceeds Number.MAX_SAFE_INTEGER`);
  }
}

/**
 * Acquire an atomic lease on a resource for a project.
 *
 * The lease is valid for `ttlMs` milliseconds. Returns `true` if the lock was acquired,
 * `false` if a conflicting lock is held (by another owner or a global lock).
 *
 * Uses `INSERT ... ON CONFLICT DO NOTHING` for atomic conflict resolution — no
 * try/catch swallows real database errors (corruption, disk full, etc.).
 *
 * Expired locks are cleaned up before the conflict check.
 *
 * 🔴 WAL SAFETY: `checkpointAfterWrite()` is called OUTSIDE `execTransaction()` and
 * ONLY when writes were actually performed.
 *
 * @param resource - The resource name (e.g., "skill-synthesis", "skill-sync"). Max 256 chars.
 * @param projectId - The project ID for scoping, or `"*"` for a global/exclusive lock. Max 256 chars.
 * @param ownerToken - Unique token identifying this owner. Required for release. Max 64 chars.
 * @param ttlMs - Lease time-to-live in milliseconds (default: 30_000ms = 30s). Must be ≥ 1.
 */
export function acquireLock(
  resource: string,
  projectId: string,
  ownerToken: string,
  ttlMs: number = 30_000,
): boolean {
  validateLockInputs(resource, projectId, ownerToken);
  validateTtl(ttlMs);

  const { acquired, hadWrites } = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + ttlMs).toISOString();
    let writes = 0;

    // Step 1: Prune expired locks before conflict check — ensures a stale lock
    // doesn't block acquisition.
    const pruneResult = db.prepare(
      "DELETE FROM maintenance_locks WHERE expires_at < ?",
    ).run(now);
    writes += pruneResult.changes;

    // Step 2: Conflict check.
    //   - Project lock: conflicts with global lock ('*') OR same-project lock.
    //   - Global lock:  conflicts with ANY active lock on the same resource.
    const conflict = projectId === "*"
      ? db.prepare(
          "SELECT 1 FROM maintenance_locks WHERE resource = ? LIMIT 1",
        ).get(resource)
      : db.prepare(
          "SELECT 1 FROM maintenance_locks WHERE resource = ? AND (project_id = '*' OR project_id = ?) LIMIT 1",
        ).get(resource, projectId);

    if (conflict) return { acquired: false, hadWrites: writes > 0 };

    // Step 3: Atomic insert with ON CONFLICT DO NOTHING.
    // If a concurrent acquire snuck in between the conflict check and this INSERT,
    // the UNIQUE constraint silently does nothing (changes = 0).
    // Real database errors (corruption, etc.) propagate without being caught.
    const insertResult = db.prepare(
      `INSERT INTO maintenance_locks (resource, project_id, owner_token, acquired_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(resource, project_id) DO NOTHING`,
    ).run(resource, projectId, ownerToken, now, expires);
    writes += insertResult.changes;

    return { acquired: insertResult.changes > 0, hadWrites: writes > 0 };
  });

  // Only checkpoint when writes were actually performed
  if (hadWrites) checkpointAfterWrite();
  return acquired;
}

/**
 * Release a lock by resource, project, and ownership token.
 *
 * The ownership token must match — this prevents one process from releasing
 * another process's lock.
 *
 * 🔴 WAL SAFETY: `checkpointAfterWrite()` is called OUTSIDE `execTransaction()` and
 * ONLY when a row was actually deleted.
 *
 * @returns `true` if the lock was found and released, `false` otherwise.
 */
export function releaseLock(resource: string, projectId: string, ownerToken: string): boolean {
  validateLockInputs(resource, projectId, ownerToken);

  const { released, hadWrites } = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const r = db.prepare(
      "DELETE FROM maintenance_locks WHERE resource = ? AND project_id = ? AND owner_token = ?",
    ).run(resource, projectId, ownerToken);
    return { released: r.changes > 0, hadWrites: r.changes > 0 };
  });

  if (hadWrites) checkpointAfterWrite();
  return released;
}

/**
 * Get the current lock status for a resource.
 *
 * Returns the lock entry if an active (unexpired) lock exists for the given
 * resource and project scope, or `undefined` if no lock is held.
 *
 * If a global lock exists on the resource, it is returned regardless of
 * the `projectId` parameter (since global locks affect all projects).
 */
export function getLockStatus(
  resource: string,
  projectId: string = "*",
): MaintenanceLock | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const now = new Date().toISOString();

  const lock = db.prepare(
    `SELECT * FROM maintenance_locks
     WHERE resource = ? AND (project_id = ? OR project_id = '*')
       AND expires_at > ?
     ORDER BY project_id = '*' ASC
     LIMIT 1`,
  ).get(resource, projectId, now) as MaintenanceLock | undefined;

  return lock;
}

/**
 * Get all active locks, optionally filtered by resource prefix.
 *
 * Only returns unexpired locks.
 */
export function listActiveLocks(resourcePrefix?: string): MaintenanceLock[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const now = new Date().toISOString();

  if (resourcePrefix) {
    return db.prepare(
      "SELECT * FROM maintenance_locks WHERE resource LIKE ? AND expires_at > ? ORDER BY resource, project_id",
    ).all(resourcePrefix + "%", now) as MaintenanceLock[];
  }
  return db.prepare(
    "SELECT * FROM maintenance_locks WHERE expires_at > ? ORDER BY resource, project_id",
  ).all(now) as MaintenanceLock[];
}

/**
 * Prune all expired locks.
 *
 * Call this periodically to clean up locks that weren't explicitly released
 * (e.g., process crashes). Safe to call at any time — only removes locks
 * where `expires_at` has passed.
 *
 * 🔴 WAL SAFETY: `checkpointAfterWrite()` is called OUTSIDE `execTransaction()` and
 * ONLY when expired rows were actually deleted.
 *
 * @returns The number of expired locks removed.
 */
export function cleanupExpiredLocks(): number {
  const { cleaned, hadWrites } = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const r = db.prepare("DELETE FROM maintenance_locks WHERE expires_at < ?").run(now);
    return { cleaned: r.changes, hadWrites: r.changes > 0 };
  });

  if (hadWrites) checkpointAfterWrite();
  return cleaned;
}

/**
 * Renew (extend) an active lease by resetting its `expires_at` timestamp.
 *
 * The lock must still be active (not expired) AND the owner token must match
 * exactly — this prevents a stale holder from resurrecting an expired lease or
 * a different process from extending someone else's lock.
 *
 * 🔴 WAL SAFETY: `checkpointAfterWrite()` is called OUTSIDE `execTransaction()` and
 * ONLY when a row was actually updated.
 *
 * @param resource - The resource name. Max 256 chars.
 * @param projectId - The project ID for scoping, or `"*"` for a global lock. Max 256 chars.
 * @param ownerToken - Exact owner token from the original `acquireLock()` call. Max 64 chars.
 * @param ttlMs - New time-to-live from *now* (default: 30_000ms = 30s). Must be ≥ 1.
 * @returns `true` if the lease was renewed, `false` if the lock is expired,
 *          held by a different owner, or does not exist.
 */
export function renewLock(
  resource: string,
  projectId: string,
  ownerToken: string,
  ttlMs: number = 30_000,
): boolean {
  validateLockInputs(resource, projectId, ownerToken);
  validateTtl(ttlMs);

  const { renewed, hadWrites } = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const newExpires = new Date(Date.now() + ttlMs).toISOString();

    // Atomic conditional UPDATE — only touches the row when:
    //   - owner_token matches (wrong owner → changes = 0)
    //   - expires_at > now (expired lease → changes = 0)
    //   - row exists at all (nonexistent → changes = 0)
    // No try/catch needed — real DB errors propagate.
    const r = db.prepare(
      `UPDATE maintenance_locks
       SET expires_at = ?
       WHERE resource = ? AND project_id = ? AND owner_token = ? AND expires_at > ?`,
    ).run(newExpires, resource, projectId, ownerToken, now);

    return { renewed: r.changes > 0, hadWrites: r.changes > 0 };
  });

  if (hadWrites) checkpointAfterWrite();
  return renewed;
}

/**
 * Generate a unique owner token for lock acquisition.
 *
 * Uses crypto.randomUUID() to produce a globally unique token that can be
 * passed to `acquireLock()` and later `releaseLock()`.
 */
export function generateOwnerToken(): string {
  return randomUUID();
}
