import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../lib/db.js";
import {
  acquireLock,
  releaseLock,
  renewLock,
  getLockStatus,
  listActiveLocks,
  cleanupExpiredLocks,
  generateOwnerToken,
} from "../lib/tools/maintenance-locks.js";
import { createProject } from "../lib/tools/projects.js";

let tempDir: string;
let projectId: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-mlocks-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  const project = createProject("test-project-mlocks");
  projectId = project.id;
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("maintenance-locks: acquire and release", () => {
  it("acquires a project-scoped lock", () => {
    const token = generateOwnerToken();
    const acquired = acquireLock("test-resource", projectId, token);
    expect(acquired).toBe(true);

    const status = getLockStatus("test-resource", projectId);
    expect(status).not.toBeUndefined();
    expect(status!.resource).toBe("test-resource");
    expect(status!.project_id).toBe(projectId);
    expect(status!.owner_token).toBe(token);

    // Release
    const released = releaseLock("test-resource", projectId, token);
    expect(released).toBe(true);

    const afterRelease = getLockStatus("test-resource", projectId);
    expect(afterRelease).toBeUndefined();
  });

  it("acquires a global lock (project_id = '*')", () => {
    const token = generateOwnerToken();
    const acquired = acquireLock("global-res", "*", token);
    expect(acquired).toBe(true);

    const status = getLockStatus("global-res", projectId);
    expect(status).not.toBeUndefined();
    expect(status!.project_id).toBe("*");
    expect(status!.resource).toBe("global-res");

    releaseLock("global-res", "*", token);
  });

  it("prevents duplicate acquire on same resource+project (ON CONFLICT DO NOTHING)", () => {
    const token1 = generateOwnerToken();
    const token2 = generateOwnerToken();

    const first = acquireLock("dup-res", projectId, token1);
    expect(first).toBe(true);

    // Second acquire should return false (not throw!) — ON CONFLICT DO NOTHING
    const second = acquireLock("dup-res", projectId, token2);
    expect(second).toBe(false);

    releaseLock("dup-res", projectId, token1);
  });

  it("duplicate acquire does NOT throw (no swallowed errors from try/catch)", () => {
    const token1 = generateOwnerToken();
    const token2 = generateOwnerToken();

    acquireLock("no-throw-dup", projectId, token1);

    // This must NOT throw — ON CONFLICT DO NOTHING handles it silently
    let threw = false;
    try {
      acquireLock("no-throw-dup", projectId, token2);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    releaseLock("no-throw-dup", projectId, token1);
  });

  it("release requires correct owner_token", () => {
    const token = generateOwnerToken();
    const wrongToken = generateOwnerToken();

    acquireLock("owner-test", projectId, token);

    const wrongRelease = releaseLock("owner-test", projectId, wrongToken);
    expect(wrongRelease).toBe(false);

    const stillLocked = getLockStatus("owner-test", projectId);
    expect(stillLocked).not.toBeUndefined();

    const correctRelease = releaseLock("owner-test", projectId, token);
    expect(correctRelease).toBe(true);
  });
});

describe("maintenance-locks: conflict rules", () => {
  it("project lock conflicts with active global lock on same resource", () => {
    const globalToken = generateOwnerToken();
    const projectToken = generateOwnerToken();

    const globalOk = acquireLock("conflict-res-1", "*", globalToken);
    expect(globalOk).toBe(true);

    const projectOk = acquireLock("conflict-res-1", projectId, projectToken);
    expect(projectOk).toBe(false);

    releaseLock("conflict-res-1", "*", globalToken);
  });

  it("global lock conflicts with any active same-resource lock", () => {
    const projectToken = generateOwnerToken();
    const globalToken = generateOwnerToken();

    const projectOk = acquireLock("conflict-res-2", projectId, projectToken);
    expect(projectOk).toBe(true);

    const globalOk = acquireLock("conflict-res-2", "*", globalToken);
    expect(globalOk).toBe(false);

    releaseLock("conflict-res-2", projectId, projectToken);
  });

  it("different resources do not conflict", () => {
    const token1 = generateOwnerToken();
    const token2 = generateOwnerToken();

    const a1 = acquireLock("res-a", projectId, token1);
    const a2 = acquireLock("res-b", projectId, token2);
    expect(a1).toBe(true);
    expect(a2).toBe(true);

    releaseLock("res-a", projectId, token1);
    releaseLock("res-b", projectId, token2);
  });

  it("different projects on same resource do not conflict (unless global lock present)", () => {
    const project2 = createProject("test-project-mlocks-2");
    const token1 = generateOwnerToken();
    const token2 = generateOwnerToken();

    const a1 = acquireLock("multi-proj", projectId, token1);
    const a2 = acquireLock("multi-proj", project2.id, token2);
    expect(a1).toBe(true);
    expect(a2).toBe(true);

    releaseLock("multi-proj", projectId, token1);
    releaseLock("multi-proj", project2.id, token2);
  });
});

describe("maintenance-locks: expiry and cleanup", () => {
  it("cleanupExpiredLocks removes expired locks", async () => {
    const token = generateOwnerToken();
    const acquired = acquireLock("expire-test", projectId, token, 1);
    expect(acquired).toBe(true);

    await new Promise((r) => setTimeout(r, 10));

    const cleaned = cleanupExpiredLocks();
    expect(cleaned).toBeGreaterThanOrEqual(1);

    const status = getLockStatus("expire-test", projectId);
    expect(status).toBeUndefined();
  });

  it("acquireLock prunes expired locks before conflict check", () => {
    const token1 = generateOwnerToken();
    const token2 = generateOwnerToken();

    acquireLock("auto-prune", projectId, token1, 1);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);

    const acquired = acquireLock("auto-prune", projectId, token2);
    expect(acquired).toBe(true);

    releaseLock("auto-prune", projectId, token2);
  });
});

describe("maintenance-locks: read operations", () => {
  it("listActiveLocks returns all active locks", () => {
    const token1 = generateOwnerToken();
    const token2 = generateOwnerToken();

    acquireLock("list-res-a", projectId, token1);
    acquireLock("list-res-b", projectId, token2);

    const all = listActiveLocks();
    expect(all.length).toBeGreaterThanOrEqual(2);

    releaseLock("list-res-a", projectId, token1);
    releaseLock("list-res-b", projectId, token2);
  });

  it("listActiveLocks with prefix filter", () => {
    const token = generateOwnerToken();
    acquireLock("prefix-foo", projectId, token);

    const filtered = listActiveLocks("prefix-");
    expect(filtered.length).toBeGreaterThanOrEqual(1);
    expect(filtered.every((l) => l.resource.startsWith("prefix-"))).toBe(true);

    releaseLock("prefix-foo", projectId, token);
  });

  it("getLockStatus returns undefined for non-existent lock", () => {
    const status = getLockStatus("nonexistent-resource", projectId);
    expect(status).toBeUndefined();
  });
});

// ============================================================
// No-op behavior: release/cleanup when nothing to do
// ============================================================
describe("maintenance-locks: no-op behavior", () => {
  it("releaseLock returns false when lock does not exist", () => {
    const token = generateOwnerToken();
    const result = releaseLock("no-such-lock", projectId, token);
    expect(result).toBe(false);
  });

  it("cleanupExpiredLocks returns 0 when no locks exist", () => {
    const result = cleanupExpiredLocks();
    expect(result).toBe(0);
  });

  it("cleanupExpiredLocks returns 0 when all locks are active (not expired)", () => {
    const token = generateOwnerToken();
    acquireLock("active-cleanup-test", projectId, token, 60_000);

    const result = cleanupExpiredLocks();
    expect(result).toBe(0);

    releaseLock("active-cleanup-test", projectId, token);
  });
});

// ============================================================
// Input validation — invalid inputs must throw, not silently fail
// ============================================================
describe("maintenance-locks: invalid input validation", () => {
  const token = "valid-token";

  it("throws on empty resource", () => {
    expect(() => acquireLock("", projectId, token)).toThrow(TypeError);
    expect(() => releaseLock("", projectId, token)).toThrow(TypeError);
    expect(() => renewLock("", projectId, token)).toThrow(TypeError);
  });

  it("throws on empty projectId", () => {
    expect(() => acquireLock("res", "", token)).toThrow(TypeError);
    expect(() => releaseLock("res", "", token)).toThrow(TypeError);
    expect(() => renewLock("res", "", token)).toThrow(TypeError);
  });

  it("throws on empty ownerToken", () => {
    expect(() => acquireLock("res", projectId, "")).toThrow(TypeError);
    expect(() => releaseLock("res", projectId, "")).toThrow(TypeError);
    expect(() => renewLock("res", projectId, "")).toThrow(TypeError);
  });

  it("throws on negative ttlMs", () => {
    expect(() => acquireLock("res", projectId, token, -1)).toThrow(TypeError);
    expect(() => renewLock("res", projectId, token, -1)).toThrow(TypeError);
  });

  it("throws on zero ttlMs", () => {
    expect(() => acquireLock("res", projectId, token, 0)).toThrow(TypeError);
    expect(() => renewLock("res", projectId, token, 0)).toThrow(TypeError);
  });

  it("throws on Infinity ttlMs", () => {
    expect(() => acquireLock("res", projectId, token, Infinity)).toThrow(TypeError);
    expect(() => renewLock("res", projectId, token, Infinity)).toThrow(TypeError);
  });

  it("throws on NaN ttlMs", () => {
    expect(() => acquireLock("res", projectId, token, NaN)).toThrow(TypeError);
    expect(() => renewLock("res", projectId, token, NaN)).toThrow(TypeError);
  });

  it("throws on resource exceeding max length (257 chars)", () => {
    const long = "a".repeat(257);
    expect(() => acquireLock(long, projectId, token)).toThrow(TypeError);
    expect(() => renewLock(long, projectId, token)).toThrow(TypeError);
  });

  it("throws on projectId exceeding max length (257 chars)", () => {
    const long = "b".repeat(257);
    expect(() => acquireLock("res", long, token)).toThrow(TypeError);
    expect(() => renewLock("res", long, token)).toThrow(TypeError);
  });

  it("throws on ownerToken exceeding max length (65 chars)", () => {
    const long = "c".repeat(65);
    expect(() => acquireLock("res", projectId, long)).toThrow(TypeError);
    expect(() => renewLock("res", projectId, long)).toThrow(TypeError);
  });
});

// ============================================================
// Lease renewal — renewLock extends an active lease
// ============================================================
describe("maintenance-locks: lease renewal", () => {
  it("successfully renews an active lease", () => {
    const token = generateOwnerToken();
    acquireLock("renew-res", projectId, token, 5_000);

    const before = getLockStatus("renew-res", projectId);
    expect(before).not.toBeUndefined();

    const renewed = renewLock("renew-res", projectId, token, 60_000);
    expect(renewed).toBe(true);

    const after = getLockStatus("renew-res", projectId);
    expect(after).not.toBeUndefined();
    // The new expiry should be well into the future
    expect(new Date(after!.expires_at).getTime()).toBeGreaterThan(
      new Date(before!.expires_at).getTime(),
    );

    releaseLock("renew-res", projectId, token);
  });

  it("returns false when owner token does not match", () => {
    const correctToken = generateOwnerToken();
    const wrongToken = generateOwnerToken();

    acquireLock("renew-wrong-owner", projectId, correctToken, 10_000);

    const renewed = renewLock("renew-wrong-owner", projectId, wrongToken, 60_000);
    expect(renewed).toBe(false);

    // The original lock should still be held by the correct owner
    const status = getLockStatus("renew-wrong-owner", projectId);
    expect(status).not.toBeUndefined();
    expect(status!.owner_token).toBe(correctToken);

    releaseLock("renew-wrong-owner", projectId, correctToken);
  });

  it("returns false for an expired lease (cannot resurrect)", async () => {
    const token = generateOwnerToken();

    // Acquire with 1ms TTL — expires almost instantly
    acquireLock("renew-expired", projectId, token, 1);
    await new Promise((r) => setTimeout(r, 10));

    // Attempt to renew the already-expired lock
    const renewed = renewLock("renew-expired", projectId, token, 60_000);
    expect(renewed).toBe(false);

    // The lock should be gone (expired and not resurrected)
    // Clean up expired locks first to be thorough
    cleanupExpiredLocks();
    const status = getLockStatus("renew-expired", projectId);
    expect(status).toBeUndefined();
  });

  it("returns false for a non-existent lock", () => {
    const token = generateOwnerToken();
    const renewed = renewLock("no-such-renew", projectId, token, 60_000);
    expect(renewed).toBe(false);
  });

  it("renew extends conflict duration (keeps conflicting acquires blocked)", () => {
    const token = generateOwnerToken();
    const otherToken = generateOwnerToken();

    // Acquire with short TTL
    acquireLock("renew-extend", projectId, token, 5_000);

    // Another acquire should be blocked
    expect(acquireLock("renew-extend", projectId, otherToken)).toBe(false);

    // Renew extends the lease
    const renewed = renewLock("renew-extend", projectId, token, 60_000);
    expect(renewed).toBe(true);

    // Another acquire should still be blocked (lease was extended, not released)
    expect(acquireLock("renew-extend", projectId, otherToken)).toBe(false);

    releaseLock("renew-extend", projectId, token);
  });

  it("renew on a global lock preserves global conflict", () => {
    const globalToken = generateOwnerToken();
    const projectToken = generateOwnerToken();

    acquireLock("renew-global", "*", globalToken, 5_000);

    // Project lock blocked by global lock
    expect(acquireLock("renew-global", projectId, projectToken)).toBe(false);

    // Renew global lock
    const renewed = renewLock("renew-global", "*", globalToken, 60_000);
    expect(renewed).toBe(true);

    // Project lock still blocked
    expect(acquireLock("renew-global", projectId, projectToken)).toBe(false);

    releaseLock("renew-global", "*", globalToken);
  });
});
