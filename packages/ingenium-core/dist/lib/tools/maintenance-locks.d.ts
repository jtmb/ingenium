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
export declare function acquireLock(resource: string, projectId: string, ownerToken: string, ttlMs?: number): boolean;
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
export declare function releaseLock(resource: string, projectId: string, ownerToken: string): boolean;
/**
 * Get the current lock status for a resource.
 *
 * Returns the lock entry if an active (unexpired) lock exists for the given
 * resource and project scope, or `undefined` if no lock is held.
 *
 * If a global lock exists on the resource, it is returned regardless of
 * the `projectId` parameter (since global locks affect all projects).
 */
export declare function getLockStatus(resource: string, projectId?: string): MaintenanceLock | undefined;
/**
 * Get all active locks, optionally filtered by resource prefix.
 *
 * Only returns unexpired locks.
 */
export declare function listActiveLocks(resourcePrefix?: string): MaintenanceLock[];
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
export declare function cleanupExpiredLocks(): number;
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
export declare function renewLock(resource: string, projectId: string, ownerToken: string, ttlMs?: number): boolean;
/**
 * Generate a unique owner token for lock acquisition.
 *
 * Uses crypto.randomUUID() to produce a globally unique token that can be
 * passed to `acquireLock()` and later `releaseLock()`.
 */
export declare function generateOwnerToken(): string;
//# sourceMappingURL=maintenance-locks.d.ts.map