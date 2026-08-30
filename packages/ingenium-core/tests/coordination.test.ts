import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { createTask, updateTask } from "../lib/tools/tasks.js";
import {
  appendContextMessage,
  createContextConversation,
} from "../lib/tools/context-conversations.js";
import {
  authorizedTakeoverCoordinationSession,
  acknowledgeCoordinationHandoffs,
  acknowledgeCoordinationMemory,
  claimCoordinationBatch,
  completeManagedMutation,
  closeCoordinationSession,
  consumeCoordinationHandoffs,
  coordinationWorktreeId,
  ensureCoordinationMemory,
  getCoordinationEpochRecoveryState,
  getCoordinationSession,
  getCoordinationStatus,
  heartbeatCoordinationSession,
  markCoordinationClaims,
  publishCoordinationHandoff,
  publishCoordinationMemory,
  quarantineCoordinationClaims,
  readCoordinationHandoffs,
  readCoordinationMemory,
  readCoordinationMemoryUpdates,
  reconcileCoordinationEpoch,
  recoverCoordinationEpoch,
  recoverCoordinationSession,
  registerCoordinationSession,
  releaseCoordinationClaims,
  updateCoordinationSnapshot,
  verifyCoordinationClaims,
  type CoordinationLeaseInput,
  type CoordinationSessionIdentity,
  type RegisterCoordinationSessionInput,
} from "../lib/tools/coordination.js";
import { parseTaskClaim, taskClaimsOverlap } from "../lib/tools/task-claims.js";

let tempDir = "";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;

const MAIN: CoordinationSessionIdentity = {
  worktreeId: "worktree-main",
  sessionId: "session-main",
  incarnation: 1,
};
const OTHER_WORKTREE: CoordinationSessionIdentity = {
  worktreeId: "worktree-other",
  sessionId: "session-main",
  incarnation: 1,
};
const SECOND_SESSION: CoordinationSessionIdentity = {
  worktreeId: "worktree-main",
  sessionId: "session-second",
  incarnation: 1,
};
const NEXT_INCARCINATION: CoordinationSessionIdentity = {
  worktreeId: "worktree-main",
  sessionId: "session-main",
  incarnation: 2,
};
const TOKEN_A = "A".repeat(32);
const TOKEN_B = "B".repeat(32);
const TOKEN_C = "C".repeat(32);
const TOKEN_D = "D".repeat(32);

function claimKey(label: string): string {
  return createHash("sha256").update(label).digest("base64url");
}

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-coordination-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
  process.env.INGENIUM_HOME = join(tempDir, "home");
  resetDbForTest();
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
  return {
    db,
    alpha: createProject("coordination-fixture-alpha"),
    beta: createProject("coordination-fixture-beta"),
  };
}

afterEach(() => {
  resetDbForTest();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
});

function expectCode(run: () => unknown, code: string): void {
  expect(run).toThrow(expect.objectContaining({ code }));
}

function register(
  projectId: string,
  identity: CoordinationSessionIdentity = MAIN,
  ownershipToken = TOKEN_A,
  idempotencyKey = `${identity.worktreeId}-${identity.sessionId}-${identity.incarnation}-register`,
) {
  const input: RegisterCoordinationSessionInput = {
    ...identity,
    ownershipToken,
    ttlMs: 2_000,
    idempotencyKey,
  };
  return registerCoordinationSession(projectId, input);
}

function lease(
  identity: CoordinationSessionIdentity,
  session: { revision: number; fence: number },
  ownershipToken: string,
  idempotencyKey: string,
  expectedRevision = session.revision,
  fence = session.fence,
): CoordinationLeaseInput {
  return {
    ...identity,
    expectedRevision,
    fence,
    ownershipToken,
    idempotencyKey,
  };
}

function takeoverInput(
  identity: CoordinationSessionIdentity,
  session: { revision: number; fence: number },
  nextOwnershipToken: string,
  idempotencyKey: string,
  expectedRevision = session.revision,
  fence = session.fence,
) {
  return {
    ...identity,
    expectedRevision,
    fence,
    ownershipToken: TOKEN_A,
    nextOwnershipToken,
    ttlMs: 2_000,
    idempotencyKey,
  };
}

function status(projectId: string, identity: CoordinationSessionIdentity = MAIN, ownershipToken = TOKEN_A) {
  return getCoordinationStatus(projectId, { ...identity, ownershipToken });
}

function migrationFilesThrough(version: number): string[] {
  const migrationDir = resolve(import.meta.dirname ?? __dirname, "../data/migrations");
  return readdirSync(migrationDir)
    .filter((file) => /^\d{3}_.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= version)
    .sort();
}

function createPreCoordinationDatabase(dbPath: string): void {
  const legacy = new Database(dbPath);
  const files = migrationFilesThrough(74);
  expect(files).toHaveLength(74);
  for (const file of files) {
    legacy.exec(readFileSync(join(resolve(import.meta.dirname ?? __dirname, "../data/migrations"), file), "utf8"));
  }
  legacy.close();
}

function deepMetadata(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: true };
  for (let index = 0; index < depth; index += 1) value = { next: value };
  return value;
}

describe("COORD-101 coordination registry fixtures", () => {
  it("creates the fresh registry with checks, composite FKs, and no foreign-key violations", () => {
    const { db, alpha } = setup();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'coordination_%' ORDER BY name",
    ).all();
    expect(tables).toEqual([
      { name: "coordination_claims" },
      { name: "coordination_handoff_cursors" },
      { name: "coordination_handoff_events" },
      { name: "coordination_managed_operations" },
      { name: "coordination_managed_paths" },
      { name: "coordination_memory_cursors" },
      { name: "coordination_mutation_receipts" },
      { name: "coordination_sessions" },
      { name: "coordination_worktree_epochs" },
      { name: "coordination_worktrees" },
    ]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const worktreeSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'coordination_worktrees'",
    ).get() as { sql: string };
    const sessionSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'coordination_sessions'",
    ).get() as { sql: string };
    const claimSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'coordination_claims'",
    ).get() as { sql: string };
    expect(worktreeSql.sql).toContain("PRIMARY KEY(project_id, worktree_id)");
    expect(worktreeSql.sql).toContain("CHECK(next_fence >= 1)");
    expect(sessionSql.sql).toContain("UNIQUE(project_id, worktree_id, session_id, incarnation)");
    expect(sessionSql.sql).toContain("json_type(snapshot_json) = 'object'");
    expect(claimSql.sql).toContain("state IN ('active', 'released', 'dirty', 'quarantined', 'collision')");
    expect(claimSql.sql).toContain("client_claim_key_hash");
    expect(db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_coordination_claims_client_key'",
    ).get()).toEqual({ count: 1 });

    expect(() => db.prepare(
      `INSERT INTO coordination_worktrees
       (project_id, worktree_id, next_fence, created_at, updated_at)
       VALUES (?, ?, 0, 'now', 'now')`,
    ).run(alpha.id, "invalid-worktree")).toThrow(/CHECK/);
    expect(() => db.prepare(
      `INSERT INTO coordination_worktrees
       (project_id, worktree_id, next_fence, created_at, updated_at)
       VALUES (?, ?, 1, 'now', 'now')`,
    ).run("missing-project", "worktree")).toThrow(/FOREIGN KEY/);
  });

  it("applies coordination migrations when components are absent and reopens cleanly", () => {
    const { db } = setup();
    expect(db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'coordination_%'",
    ).get()).toEqual({ count: 10 });

    resetDbForTest();
    const reopened = getDb(process.env.INGENIUM_CORE_DB_PATH);
    expect(reopened.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'coordination_%'",
    ).get()).toEqual({ count: 10 });
    expect(reopened.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("fails closed for representative early and late partial migration states", () => {
    const first = setup();
    first.db.prepare("DROP TABLE coordination_worktrees").run();
    resetDbForTest();
    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow(
      /Migration 075 is in a PARTIAL state.*coordination_worktrees table/,
    );

    resetDbForTest();
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = mkdtempSync(join(tmpdir(), "ingenium-coordination-late-"));
    process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
    process.env.INGENIUM_HOME = join(tempDir, "home");
    const second = getDb(process.env.INGENIUM_CORE_DB_PATH);
    second.prepare("DROP TRIGGER coordination_mutation_receipts_immutable_update").run();
    resetDbForTest();
    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow(
      /Migration 075 is in a PARTIAL state.*coordination_mutation_receipts_immutable_update trigger/,
    );
  });

  it("fails closed when the coordination memory cursor migration is partial", () => {
    const { db } = setup();
    db.prepare("DROP INDEX idx_coordination_memory_cursors_worktree").run();
    resetDbForTest();
    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow(
      /Migration 110 is in a PARTIAL state.*idx_coordination_memory_cursors_worktree index/,
    );
  });

  it("fails closed when atomic epoch recovery schema is partial", () => {
    const { db } = setup();
    db.prepare("DROP TRIGGER coordination_epochs_clear_recovery_proof").run();
    resetDbForTest();
    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow(
      /Migration 112 is in a PARTIAL state.*coordination_epochs_clear_recovery_proof trigger/,
    );
  });

  it("fails closed when the immutable receipt trigger is replaced with a no-op or wrong table", () => {
    for (const replacement of [
      `CREATE TRIGGER coordination_mutation_receipts_immutable_update
       BEFORE UPDATE ON coordination_mutation_receipts BEGIN SELECT 1; END;`,
      `CREATE TRIGGER coordination_mutation_receipts_immutable_update
       BEFORE UPDATE ON projects
       BEGIN SELECT RAISE(ABORT, 'coordination mutation receipts are immutable'); END;`,
    ]) {
      const { db } = setup();
      db.exec(`DROP TRIGGER coordination_mutation_receipts_immutable_update; ${replacement}`);
      resetDbForTest();
      expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow(
        /Migration 075 is in a PARTIAL state.*coordination_mutation_receipts_immutable_update immutable trigger semantics/,
      );
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("isolates project, worktree, session, and incarnation identities", () => {
    const { alpha, beta } = setup();
    const alphaMain = register(alpha.id, MAIN, TOKEN_A, "alpha-main");
    const betaMain = register(beta.id, MAIN, TOKEN_B, "beta-main");
    const alphaOther = register(alpha.id, OTHER_WORKTREE, TOKEN_C, "alpha-other");
    const alphaSecond = register(alpha.id, SECOND_SESSION, TOKEN_D, "alpha-second");
    const alphaNext = register(alpha.id, NEXT_INCARCINATION, "E".repeat(32), "alpha-next-incarnation");

    expect(alphaMain.fence).toBe(1);
    expect(betaMain.fence).toBe(1);
    expect(alphaOther.fence).toBe(1);
    expect(alphaSecond.fence).toBe(2);
    expect(alphaNext.fence).toBe(3);
    expect(getCoordinationSession(beta.id, alphaMain.id)).toBeUndefined();
    expectCode(
      () => register(alpha.id, MAIN, TOKEN_A, "alpha-main-different-receipt"),
      "SESSION_IDENTITY_CONFLICT",
    );

    const alphaClaim = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, alphaMain, TOKEN_A, "alpha-claim"),
      clientClaimKey: claimKey("alpha-claim"),
      claims: [{ claim: { kind: "path", path: "same/path" } }],
    });
    expect(claimCoordinationBatch(beta.id, {
      ...lease(MAIN, betaMain, TOKEN_B, "beta-claim"),
      clientClaimKey: claimKey("beta-claim"),
      claims: [{ claim: { kind: "path", path: "same/path" } }],
    }).session.revision).toBe(betaMain.revision + 1);
    expect(claimCoordinationBatch(alpha.id, {
      ...lease(OTHER_WORKTREE, alphaOther, TOKEN_C, "other-worktree-claim"),
      clientClaimKey: claimKey("other-worktree-claim"),
      claims: [{ claim: { kind: "path", path: "same/path" } }],
    }).session.revision).toBe(alphaOther.revision + 1);
    expectCode(() => claimCoordinationBatch(alpha.id, {
      ...lease(SECOND_SESSION, alphaSecond, TOKEN_D, "same-worktree-collision"),
      clientClaimKey: claimKey("same-worktree-collision"),
      claims: [{ claim: { kind: "path", path: "same/path" } }],
    }), "CLAIM_CONFLICT");
    expect(alphaClaim).toEqual(expect.objectContaining({ session: expect.any(Object) }));
    expect(status(alpha.id)?.claims[0]).toMatchObject({ kind: "path", state: "active" });
  });

  it("reaps expired claims atomically while one live fenced owner remains the only winner", () => {
    const { db, alpha } = setup();
    const crashed = register(alpha.id);
    claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, crashed, TOKEN_A, "expired-owner-claim"),
      clientClaimKey: claimKey("expired-owner-claim"),
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    });
    const contender = register(alpha.id, SECOND_SESSION, TOKEN_B, "contender-register");
    expectCode(() => claimCoordinationBatch(alpha.id, {
      ...lease(SECOND_SESSION, contender, TOKEN_B, "live-owner-conflict"),
      clientClaimKey: claimKey("live-owner-conflict"),
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    }), "CLAIM_CONFLICT");

    db.prepare("UPDATE coordination_sessions SET expires_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", crashed.id);
    const observerIdentity = { worktreeId: MAIN.worktreeId, sessionId: "session-observer", incarnation: 1 };
    const observer = register(alpha.id, observerIdentity, TOKEN_C, "observer-register-reaps");
    expect(db.prepare("SELECT state FROM coordination_claims WHERE value = ?").get("@repository"))
      .toEqual({ state: "released" });

    const winner = claimCoordinationBatch(alpha.id, {
      ...lease(SECOND_SESSION, contender, TOKEN_B, "contender-wins"),
      clientClaimKey: claimKey("contender-wins"),
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    });
    expectCode(() => claimCoordinationBatch(alpha.id, {
      ...lease(observerIdentity, observer, TOKEN_C, "observer-loses"),
      clientClaimKey: claimKey("observer-loses"),
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    }), "CLAIM_CONFLICT");
    expect(winner.session.fence).toBeGreaterThan(crashed.fence);

    const marked = markCoordinationClaims(alpha.id, {
      ...lease(SECOND_SESSION, winner.session, TOKEN_B, "winner-dirty"),
      clientClaimKey: claimKey("contender-wins"),
      state: "dirty",
    });
    closeCoordinationSession(alpha.id, lease(SECOND_SESSION, marked.session, TOKEN_B, "winner-close"));
    expect(db.prepare("SELECT state FROM coordination_claims WHERE coordination_session_id = ? AND value = ?").get(contender.id, "@repository"))
      .toEqual({ state: "released" });

    const nextWinner = claimCoordinationBatch(alpha.id, {
      ...lease(observerIdentity, observer, TOKEN_C, "observer-next-winner"),
      clientClaimKey: claimKey("observer-next-winner"),
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    });
    expect(nextWinner.session.revision).toBe(observer.revision + 1);
    const cleanupIdentity = { worktreeId: MAIN.worktreeId, sessionId: "session-cleanup", incarnation: 1 };
    register(alpha.id, cleanupIdentity, TOKEN_D, "cleanup-idempotent");
    expect(db.prepare("SELECT state FROM coordination_claims WHERE coordination_session_id = ? AND value = ?").get(observer.id, "@repository"))
      .toEqual({ state: "active" });
  });

  it("advances a stale contender beyond an expired owner's fence before acquiring its claim", () => {
    const { db, alpha } = setup();
    const contender = register(alpha.id, SECOND_SESSION, TOKEN_B, "stale-contender-register");
    const owner = register(alpha.id, MAIN, TOKEN_A, "newer-owner-register");
    const owned = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, owner, TOKEN_A, "newer-owner-claim"),
      clientClaimKey: claimKey("newer-owner-claim"),
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    });
    expect(contender.fence).toBe(1);
    expect(owned.session.fence).toBe(2);

    db.prepare("UPDATE coordination_sessions SET expires_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", owner.id);
    const winner = claimCoordinationBatch(alpha.id, {
      ...lease(SECOND_SESSION, contender, TOKEN_B, "stale-contender-wins"),
      clientClaimKey: claimKey("stale-contender-wins"),
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    });

    expect(winner.session.fence).toBeGreaterThan(owned.session.fence);
    expect(db.prepare("SELECT fence FROM coordination_claims WHERE coordination_session_id = ? AND value = ?").get(contender.id, "@repository"))
      .toEqual({ fence: winner.session.fence });
    expectCode(() => claimCoordinationBatch(alpha.id, {
      ...lease(SECOND_SESSION, contender, TOKEN_B, "stale-contender-loses"),
      clientClaimKey: claimKey("stale-contender-loses"),
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    }), "REVISION_CONFLICT");
    expect(db.prepare("SELECT state FROM coordination_claims WHERE coordination_session_id = ? AND value = ?").get(owner.id, "@repository"))
      .toEqual({ state: "released" });
  });

  it("never releases a claim through a foreign project, worktree, session, incarnation, or fence", () => {
    const { alpha, beta } = setup();
    const owner = register(alpha.id);
    const claimed = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, owner, TOKEN_A, "exact-owner-claim"),
      clientClaimKey: claimKey("exact-owner-claim"),
      claims: [{ claim: { kind: "path", path: "exact/owner" } }],
    });
    const foreignWorktree = register(alpha.id, OTHER_WORKTREE, TOKEN_B, "foreign-worktree-register");
    const foreignProject = register(beta.id, MAIN, TOKEN_C, "foreign-project-register");

    expectCode(() => releaseCoordinationClaims(alpha.id, {
      ...lease(OTHER_WORKTREE, foreignWorktree, TOKEN_B, "foreign-worktree-release"),
      clientClaimKey: claimKey("exact-owner-claim"),
    }), "CLAIM_NOT_FOUND");
    expectCode(() => releaseCoordinationClaims(beta.id, {
      ...lease(MAIN, foreignProject, TOKEN_C, "foreign-project-release"),
      clientClaimKey: claimKey("exact-owner-claim"),
    }), "CLAIM_NOT_FOUND");
    expectCode(() => releaseCoordinationClaims(alpha.id, {
      ...lease(MAIN, claimed.session, TOKEN_A, "wrong-incarnation-release"),
      incarnation: 2,
      clientClaimKey: claimKey("exact-owner-claim"),
    }), "SESSION_NOT_FOUND");
    expectCode(() => releaseCoordinationClaims(alpha.id, {
      ...lease(MAIN, claimed.session, TOKEN_A, "wrong-fence-release", claimed.session.revision, claimed.session.fence + 1),
      clientClaimKey: claimKey("exact-owner-claim"),
    }), "FENCE_CONFLICT");
    expect(status(alpha.id)?.claims[0]).toMatchObject({
      state: "active",
    });
  });

  it("stores only the ownership hash and never discloses token material", () => {
    const { db, alpha } = setup();
    const token = "fixture-token-012345678901234567";
    const session = register(alpha.id, MAIN, token, "hash-register");
    const expectedHash = createHash("sha256").update(token, "utf8").digest("hex");
    expect(db.prepare("SELECT ownership_token_hash FROM coordination_sessions WHERE id = ?").get(session.id))
      .toEqual({ ownership_token_hash: expectedHash });
    expect(JSON.stringify(session)).not.toContain(token);
    expect(JSON.stringify(session)).not.toContain(expectedHash);
    const read = getCoordinationSession(alpha.id, session.id)!;
    expect(JSON.stringify(read)).not.toContain(token);
    expect(JSON.stringify(read)).not.toContain(expectedHash);
    expectCode(() => heartbeatCoordinationSession(alpha.id, {
      ...lease(MAIN, session, "wrong-token-012345678901234567890", "hash-wrong-token"),
      ttlMs: 2_000,
    }), "OWNERSHIP_TOKEN_MISMATCH");
  });

  it("stores only client claim-key hashes and never returns internal claim UUIDs", () => {
    const { db, alpha } = setup();
    const session = register(alpha.id);
    const clientClaimKey = claimKey("private-client-claim-key");
    const claimed = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "private-client-claim"),
      clientClaimKey,
      claims: [{ claim: { kind: "path", path: "safe/client-key.ts" } }],
    });
    const row = db.prepare(
      "SELECT id, client_claim_key_hash FROM coordination_claims WHERE project_id = ? AND value = ?",
    ).get(alpha.id, "safe/client-key.ts") as { id: string; client_claim_key_hash: string };
    const expectedHash = createHash("sha256").update(clientClaimKey).digest("hex");

    expect(row.client_claim_key_hash).toBe(expectedHash);
    expect(JSON.stringify({ claimed, status: status(alpha.id) })).not.toMatch(
      new RegExp(`${row.id}|${clientClaimKey}|${expectedHash}`),
    );
    const released = releaseCoordinationClaims(alpha.id, {
      ...lease(MAIN, claimed.session, TOKEN_A, "private-client-release"),
      clientClaimKey,
    });
    expect(released).toEqual({ session: expect.any(Object), acceptedEpoch: 1, manifestGeneration: 0 });
    expectCode(() => claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, released.session, TOKEN_A, "private-client-key-reuse"),
      clientClaimKey,
      claims: [{ claim: { kind: "path", path: "safe/reused-key.ts" } }],
    }), "CLAIM_KEY_REUSED");
    expectCode(() => claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, released.session, TOKEN_A, "ownership-token-as-claim-key"),
      clientClaimKey: TOKEN_A,
      claims: [{ claim: { kind: "path", path: "safe/shared-value.ts" } }],
    }), "INVALID_COORDINATION_INPUT");
  });

  it("replays an exact registration before identity checks and rejects a changed request hash", () => {
    const { alpha, beta } = setup();
    const first = register(alpha.id, MAIN, TOKEN_A, "register-replay");
    expect(register(alpha.id, MAIN, TOKEN_A, "register-replay")).toEqual(first);
    expectCode(() => register(alpha.id, MAIN, TOKEN_B, "register-replay"), "IDEMPOTENCY_KEY_REUSED");
  });

  it("rejects stale revisions and extends only an unexpired active heartbeat", () => {
    const { db, alpha } = setup();
    const session = register(alpha.id);
    const first = heartbeatCoordinationSession(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "heartbeat-first"),
      ttlMs: 2_000,
    });
    expect(Date.parse(first.expiresAt)).toBeGreaterThan(Date.parse(session.expiresAt));
    expectCode(() => heartbeatCoordinationSession(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "heartbeat-stale"),
      ttlMs: 2_000,
    }), "REVISION_CONFLICT");

    db.prepare("UPDATE coordination_sessions SET expires_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", session.id);
    expectCode(() => heartbeatCoordinationSession(alpha.id, {
      ...lease(MAIN, first, TOKEN_A, "heartbeat-expired"),
      ttlMs: 2_000,
    }), "SESSION_EXPIRED");
  });

  it("keeps fences monotonic through recovery, close, and a new incarnation", () => {
    const { alpha } = setup();
    const first = register(alpha.id);
    const recovered = recoverCoordinationSession(alpha.id, {
      ...lease(MAIN, first, TOKEN_A, "recover-main"),
      nextOwnershipToken: TOKEN_B,
      ttlMs: 2_000,
    });
    expect(recovered.fence).toBeGreaterThan(first.fence);
    expect(recovered.revision).toBe(1);
    expectCode(() => heartbeatCoordinationSession(alpha.id, {
      ...lease(MAIN, recovered, TOKEN_A, "old-token-after-recover"),
      ttlMs: 2_000,
    }), "OWNERSHIP_TOKEN_MISMATCH");
    expectCode(() => heartbeatCoordinationSession(alpha.id, {
      ...lease(MAIN, recovered, TOKEN_B, "old-fence-after-recover", recovered.revision, first.fence),
      ttlMs: 2_000,
    }), "FENCE_CONFLICT");

    const closed = closeCoordinationSession(alpha.id, lease(MAIN, recovered, TOKEN_B, "close-main"));
    expect(closed.state).toBe("closed");
    const next = register(alpha.id, NEXT_INCARCINATION, TOKEN_C, "register-incarnation-2");
    expect(next.fence).toBeGreaterThan(closed.fence);
    expectCode(() => heartbeatCoordinationSession(alpha.id, {
      ...lease(NEXT_INCARCINATION, next, TOKEN_A, "old-token-new-incarnation"),
      ttlMs: 2_000,
    }), "OWNERSHIP_TOKEN_MISMATCH");
    expectCode(() => heartbeatCoordinationSession(alpha.id, {
      ...lease(NEXT_INCARCINATION, next, TOKEN_C, "old-fence-new-incarnation", next.revision, first.fence),
      ttlMs: 2_000,
    }), "FENCE_CONFLICT");
  });

  it("takes over an exact session with stable evidence and no token disclosure", () => {
    const { db, alpha, beta } = setup();
    const session = register(alpha.id);
    const claimed = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "takeover-claim"),
      clientClaimKey: claimKey("takeover-claim"),
      claims: [{ claim: { kind: "path", path: "takeover/retained" } }],
    });
    const input = takeoverInput(MAIN, claimed.session, TOKEN_B, "authorized-takeover");
    const taken = authorizedTakeoverCoordinationSession(alpha.id, input);
    const expectedHash = createHash("sha256").update(TOKEN_B, "utf8").digest("hex");
    const receipt = db.prepare(
      "SELECT result_json FROM coordination_mutation_receipts WHERE project_id = ? AND idempotency_key = ?",
    ).get(alpha.id, input.idempotencyKey) as { result_json: string };

    expect(taken).toMatchObject({ state: "active", revision: claimed.session.revision + 1 });
    expect(taken.fence).toBeGreaterThan(claimed.session.fence);
    expect(taken.takeoverEvidenceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(authorizedTakeoverCoordinationSession(alpha.id, input)).toEqual(taken);
    expect(JSON.parse(receipt.result_json)).toEqual(taken);
    expect(db.prepare("SELECT ownership_token_hash FROM coordination_sessions WHERE id = ?").get(session.id))
      .toEqual({ ownership_token_hash: expectedHash });
    expect(db.prepare("SELECT next_fence FROM coordination_worktrees WHERE project_id = ? AND worktree_id = ?")
      .get(alpha.id, MAIN.worktreeId)).toEqual({ next_fence: taken.fence + 1 });
    expect(status(alpha.id, MAIN, TOKEN_B)?.claims[0]).toMatchObject({
      state: "active",
    });
    expect(JSON.stringify({ taken, receipt, read: getCoordinationSession(alpha.id, session.id) }))
      .not.toMatch(new RegExp(`${TOKEN_A}|${TOKEN_B}|${expectedHash}`));
    expect(db.prepare("SELECT count(*) AS count FROM coordination_mutation_receipts").get()).toEqual({ count: 3 });

    expectCode(() => authorizedTakeoverCoordinationSession(alpha.id, {
      ...input,
      nextOwnershipToken: TOKEN_C,
    }), "IDEMPOTENCY_KEY_REUSED");
    expectCode(() => authorizedTakeoverCoordinationSession(alpha.id, takeoverInput(
      MAIN, taken, TOKEN_C, "takeover-stale-revision", claimed.session.revision,
    )), "REVISION_CONFLICT");
    expectCode(() => authorizedTakeoverCoordinationSession(alpha.id, takeoverInput(
      MAIN, taken, TOKEN_C, "takeover-stale-fence", taken.revision, claimed.session.fence,
    )), "FENCE_CONFLICT");
    expectCode(() => heartbeatCoordinationSession(alpha.id, {
      ...lease(MAIN, taken, TOKEN_A, "takeover-old-token"),
      ttlMs: 2_000,
    }), "OWNERSHIP_TOKEN_MISMATCH");
    expectCode(() => heartbeatCoordinationSession(alpha.id, {
      ...lease(MAIN, taken, TOKEN_B, "takeover-old-fence", taken.revision, claimed.session.fence),
      ttlMs: 2_000,
    }), "FENCE_CONFLICT");
    expectCode(() => authorizedTakeoverCoordinationSession(beta.id, {
      ...input,
      idempotencyKey: "takeover-foreign",
    }), "SESSION_NOT_FOUND");

    const closeIdentity = SECOND_SESSION;
    const closeSource = register(alpha.id, closeIdentity, TOKEN_C, "takeover-closed-register");
    const closed = closeCoordinationSession(alpha.id, lease(closeIdentity, closeSource, TOKEN_C, "takeover-closed-close"));
    expectCode(() => authorizedTakeoverCoordinationSession(alpha.id, {
      ...takeoverInput(closeIdentity, closed, TOKEN_D, "takeover-closed"),
      ownershipToken: TOKEN_C,
    }), "SESSION_CLOSED");
  });

  it("requires exact ownership proof for status, takeover, release, and close replay", () => {
    const { alpha, beta } = setup();
    const owner = register(alpha.id);
    const claimed = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, owner, TOKEN_A, "ownership-claim"),
      clientClaimKey: claimKey("ownership-claim"),
      claims: [{ claim: { kind: "path", path: "ownership/protected" } }],
    });
    register(alpha.id, SECOND_SESSION, TOKEN_B, "ownership-sibling");

    expect(status(alpha.id, MAIN, TOKEN_B)).toBeUndefined();
    expect(status(beta.id, MAIN, TOKEN_A)).toBeUndefined();
    expect(status(alpha.id, OTHER_WORKTREE, TOKEN_A)).toBeUndefined();
    expectCode(() => authorizedTakeoverCoordinationSession(alpha.id, {
      ...takeoverInput(MAIN, claimed.session, TOKEN_C, "ownership-sibling-takeover"),
      ownershipToken: TOKEN_B,
    }), "OWNERSHIP_TOKEN_MISMATCH");
    expectCode(() => releaseCoordinationClaims(alpha.id, {
      ...lease(MAIN, claimed.session, TOKEN_B, "ownership-sibling-release"),
      clientClaimKey: claimKey("ownership-claim"),
    }), "OWNERSHIP_TOKEN_MISMATCH");
    expect(status(alpha.id)?.claims).toEqual([
      expect.objectContaining({ state: "active" }),
    ]);

    const releaseInput = {
      ...lease(MAIN, claimed.session, TOKEN_A, "ownership-owner-release"),
      clientClaimKey: claimKey("ownership-claim"),
    };
    const released = releaseCoordinationClaims(alpha.id, releaseInput);
    expect(releaseCoordinationClaims(alpha.id, releaseInput)).toEqual(released);
    const closeInput = lease(MAIN, released.session, TOKEN_A, "ownership-owner-close");
    const closed = closeCoordinationSession(alpha.id, closeInput);
    expect(closeCoordinationSession(alpha.id, closeInput)).toEqual(closed);
  });

  it("rejects a takeover token already present in the persisted snapshot without a receipt", () => {
    const { db, alpha } = setup();
    const session = register(alpha.id);
    const staged = updateCoordinationSnapshot(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "takeover-snapshot-stage"),
      snapshot: { phase: TOKEN_B },
      snapshotRevision: 1,
      currentTaskId: null,
      currentTaskRevision: null,
      contextConversationId: null,
      contextRevision: null,
    });
    const before = getCoordinationSession(alpha.id, session.id)!;
    expectCode(() => authorizedTakeoverCoordinationSession(alpha.id, takeoverInput(
      MAIN, staged, TOKEN_B, "takeover-snapshot-reject",
    )), "INVALID_COORDINATION_INPUT");
    expect(getCoordinationSession(alpha.id, session.id)).toEqual(before);
    expect(db.prepare("SELECT count(*) AS count FROM coordination_mutation_receipts").get()).toEqual({ count: 2 });
  });

  it("rejects ownership tokens that collide with public session identities or pointers before receipts", () => {
    const { db, alpha } = setup();
    expectCode(() => registerCoordinationSession(alpha.id, {
      worktreeId: TOKEN_A,
      sessionId: "session-register-collision",
      incarnation: 1,
      ownershipToken: TOKEN_A,
      ttlMs: 2_000,
      idempotencyKey: "register-token-worktree-collision",
    }), "INVALID_COORDINATION_INPUT");
    expectCode(() => registerCoordinationSession(alpha.id, {
      worktreeId: "worktree-register-collision",
      sessionId: TOKEN_A,
      incarnation: 1,
      ownershipToken: TOKEN_A,
      ttlMs: 2_000,
      idempotencyKey: "register-token-session-collision",
    }), "INVALID_COORDINATION_INPUT");
    expect(db.prepare("SELECT count(*) AS count FROM coordination_mutation_receipts").get()).toEqual({ count: 0 });

    const publicIdentity: CoordinationSessionIdentity = {
      worktreeId: "public-worktree",
      sessionId: TOKEN_C,
      incarnation: 1,
    };
    const session = register(alpha.id, publicIdentity, TOKEN_A, "public-identity-register");
    expectCode(() => recoverCoordinationSession(alpha.id, {
      ...lease(publicIdentity, session, TOKEN_C, "recover-current-session-id-collision"),
      nextOwnershipToken: TOKEN_D,
      ttlMs: 2_000,
    }), "INVALID_COORDINATION_INPUT");
    expectCode(() => recoverCoordinationSession(alpha.id, {
      ...lease(publicIdentity, session, TOKEN_A, "recover-next-session-id-collision"),
      nextOwnershipToken: TOKEN_C,
      ttlMs: 2_000,
    }), "INVALID_COORDINATION_INPUT");

    const task = createTask(alpha.id, "public pointer task");
    const context = createContextConversation(alpha.id, {
      title: "public pointer context",
      idempotencyKey: "public-pointer-context",
    });
    const pointed = updateCoordinationSnapshot(alpha.id, {
      ...lease(publicIdentity, session, TOKEN_A, "public-pointer-stage"),
      snapshot: { task: task.id, context: context.id },
      snapshotRevision: 1,
      currentTaskId: task.id,
      currentTaskRevision: task.revision,
      contextConversationId: context.id,
      contextRevision: context.revision,
    });
    for (const [idempotencyKey, nextOwnershipToken] of [
      ["takeover-session-id-collision", TOKEN_C],
      ["takeover-internal-session-id-collision", session.id],
      ["takeover-task-pointer-collision", task.id],
      ["takeover-context-pointer-collision", context.id],
    ] as const) {
      expectCode(() => authorizedTakeoverCoordinationSession(alpha.id, takeoverInput(
        publicIdentity, pointed, nextOwnershipToken, idempotencyKey,
      )), "INVALID_COORDINATION_INPUT");
    }
    expect(db.prepare("SELECT count(*) AS count FROM coordination_mutation_receipts").get()).toEqual({ count: 2 });

    const taken = authorizedTakeoverCoordinationSession(alpha.id, takeoverInput(
      publicIdentity, pointed, "E".repeat(32), "takeover-safe-token",
    ));
    expect(taken.state).toBe("active");
    expect(db.prepare("SELECT count(*) AS count FROM coordination_mutation_receipts").get()).toEqual({ count: 3 });
  });

  it("rejects snapshot pointers equal to the active ownership token without exposing it", () => {
    const { db, alpha } = setup();
    const tokenTask = createTask(alpha.id, "token task");
    const unrelatedTask = createTask(alpha.id, "unrelated task");
    const tokenContext = createContextConversation(alpha.id, {
      title: "token context",
      idempotencyKey: "token-context",
    });
    const unrelatedContext = createContextConversation(alpha.id, {
      title: "unrelated context",
      idempotencyKey: "unrelated-context",
    });

    const taskTokenSession = register(alpha.id, MAIN, tokenTask.id, "task-token-register");
    const taskBefore = getCoordinationSession(alpha.id, taskTokenSession.id)!;
    expectCode(() => updateCoordinationSnapshot(alpha.id, {
      ...lease(MAIN, taskTokenSession, tokenTask.id, "task-token-pointer"),
      snapshot: { phase: "task-pointer" },
      snapshotRevision: 1,
      currentTaskId: tokenTask.id,
      currentTaskRevision: tokenTask.revision,
      contextConversationId: null,
      contextRevision: null,
    }), "INVALID_COORDINATION_INPUT");
    expect(getCoordinationSession(alpha.id, taskTokenSession.id)).toEqual(taskBefore);
    expect(db.prepare("SELECT count(*) AS count FROM coordination_mutation_receipts").get()).toEqual({ count: 1 });
    expect(JSON.stringify(status(alpha.id, MAIN, tokenTask.id))).not.toContain(tokenTask.id);

    const taskSafe = updateCoordinationSnapshot(alpha.id, {
      ...lease(MAIN, taskTokenSession, tokenTask.id, "task-token-safe"),
      snapshot: { phase: "safe" },
      snapshotRevision: 1,
      currentTaskId: unrelatedTask.id,
      currentTaskRevision: unrelatedTask.revision,
      contextConversationId: unrelatedContext.id,
      contextRevision: unrelatedContext.revision,
    });
    expect(taskSafe.currentTaskId).toBe(unrelatedTask.id);
    expect(taskSafe.contextConversationId).toBe(unrelatedContext.id);

    const contextTokenSession = register(alpha.id, OTHER_WORKTREE, tokenContext.id, "context-token-register");
    const contextBefore = getCoordinationSession(alpha.id, contextTokenSession.id)!;
    expectCode(() => updateCoordinationSnapshot(alpha.id, {
      ...lease(OTHER_WORKTREE, contextTokenSession, tokenContext.id, "context-token-pointer"),
      snapshot: { phase: "context-pointer" },
      snapshotRevision: 1,
      currentTaskId: unrelatedTask.id,
      currentTaskRevision: unrelatedTask.revision,
      contextConversationId: tokenContext.id,
      contextRevision: tokenContext.revision,
    }), "INVALID_COORDINATION_INPUT");
    expect(getCoordinationSession(alpha.id, contextTokenSession.id)).toEqual(contextBefore);
    expect(db.prepare("SELECT count(*) AS count FROM coordination_mutation_receipts").get()).toEqual({ count: 3 });
    expect(JSON.stringify(status(alpha.id, OTHER_WORKTREE, tokenContext.id))).not.toContain(tokenContext.id);

    const contextSafe = updateCoordinationSnapshot(alpha.id, {
      ...lease(OTHER_WORKTREE, contextTokenSession, tokenContext.id, "context-token-safe"),
      snapshot: { phase: "safe" },
      snapshotRevision: 1,
      currentTaskId: unrelatedTask.id,
      currentTaskRevision: unrelatedTask.revision,
      contextConversationId: unrelatedContext.id,
      contextRevision: unrelatedContext.revision,
    });
    expect(contextSafe.currentTaskId).toBe(unrelatedTask.id);
    expect(contextSafe.contextConversationId).toBe(unrelatedContext.id);
  });

  it("enforces snapshot node, depth, byte, and revision bounds", () => {
    const { alpha } = setup();
    const session = register(alpha.id);
    const base = {
      ...lease(MAIN, session, TOKEN_A, "snapshot-valid"),
      snapshotRevision: 7,
      currentTaskId: null,
      currentTaskRevision: null,
      contextConversationId: null,
      contextRevision: null,
    };
    const updated = updateCoordinationSnapshot(alpha.id, { ...base, snapshot: { phase: "fixture" } });
    expect(updated.snapshotRevision).toBe(7);
    expect(getCoordinationSession(alpha.id, session.id)?.snapshot).toEqual({ phase: "fixture" });

    expectCode(() => updateCoordinationSnapshot(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "snapshot-too-deep"),
      snapshot: deepMetadata(8),
      snapshotRevision: 8,
      currentTaskId: null,
      currentTaskRevision: null,
      contextConversationId: null,
      contextRevision: null,
    }), "INVALID_COORDINATION_INPUT");
    expectCode(() => updateCoordinationSnapshot(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "snapshot-too-many-nodes"),
      snapshot: { items: Array.from({ length: 64 }, () => [true, true]) },
      snapshotRevision: 8,
      currentTaskId: null,
      currentTaskRevision: null,
      contextConversationId: null,
      contextRevision: null,
    }), "INVALID_COORDINATION_INPUT");
    expectCode(() => updateCoordinationSnapshot(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "snapshot-too-large"),
      snapshot: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`key-${index}`, "x".repeat(4_096)])),
      snapshotRevision: 8,
      currentTaskId: null,
      currentTaskRevision: null,
      contextConversationId: null,
      contextRevision: null,
    }), "INVALID_COORDINATION_INPUT");
  });

  it("rejects credential-bearing or ownership-token snapshots before hashing or persistence", () => {
    const { db, alpha } = setup();
    const session = register(alpha.id);
    const snapshotInput = {
      ...lease(MAIN, session, TOKEN_A, "snapshot-secret"),
      snapshotRevision: 1,
      currentTaskId: null,
      currentTaskRevision: null,
      contextConversationId: null,
      contextRevision: null,
    };
    for (const [index, snapshot] of [
      { phase: `resuming-${TOKEN_A}` },
      { [TOKEN_A]: "redacted" },
      { token: "redacted" },
      { nested: { "client-secret": "redacted", password: "redacted", credential: "redacted" } },
      { authorization: "redacted", bearer: "redacted", "private key": "redacted", api_key: "redacted" },
    ].entries()) {
      expectCode(() => updateCoordinationSnapshot(alpha.id, {
        ...snapshotInput,
        idempotencyKey: `snapshot-secret-${index}`,
        snapshot,
      }), "INVALID_COORDINATION_INPUT");
    }
    const persisted = db.prepare(
      "SELECT snapshot_json, result_json FROM coordination_sessions LEFT JOIN coordination_mutation_receipts USING (project_id) WHERE coordination_sessions.id = ?",
    ).all(session.id);
    expect(persisted).toEqual([
      expect.objectContaining({ snapshot_json: "{}" }),
    ]);
    expect(JSON.stringify(persisted)).not.toContain(TOKEN_A);
    expect(db.prepare("SELECT count(*) AS count FROM coordination_mutation_receipts").get()).toEqual({ count: 1 });

    const safe = updateCoordinationSnapshot(alpha.id, {
      ...snapshotInput,
      idempotencyKey: "snapshot-operational",
      snapshot: { operation: "claim", retryCount: 1, nested: { phase: "resume" } },
    });
    expect(getCoordinationSession(alpha.id, session.id)?.snapshot).toEqual({
      operation: "claim", retryCount: 1, nested: { phase: "resume" },
    });

    const staged = updateCoordinationSnapshot(alpha.id, {
      ...snapshotInput,
      expectedRevision: safe.revision,
      idempotencyKey: "snapshot-future-token",
      snapshotRevision: 2,
      snapshot: { phase: TOKEN_B },
    });
    const beforeRejectedRecovery = getCoordinationSession(alpha.id, session.id)!;
    expectCode(() => recoverCoordinationSession(alpha.id, {
      ...lease(MAIN, staged, TOKEN_A, "recover-token-in-snapshot"),
      nextOwnershipToken: TOKEN_B,
      ttlMs: 2_000,
    }), "INVALID_COORDINATION_INPUT");
    expect(db.prepare("SELECT count(*) AS count FROM coordination_mutation_receipts").get()).toEqual({ count: 3 });
    expect(getCoordinationSession(alpha.id, session.id)).toEqual(beforeRejectedRecovery);

    const recovered = recoverCoordinationSession(alpha.id, {
      ...lease(MAIN, staged, TOKEN_A, "recover-safe-next-token"),
      nextOwnershipToken: TOKEN_C,
      ttlMs: 2_000,
    });
    const readAfterRecovery = getCoordinationSession(alpha.id, session.id)!;
    expect(recovered.fence).toBeGreaterThan(staged.fence);
    expect(JSON.stringify(readAfterRecovery)).not.toContain(TOKEN_A);
    expect(JSON.stringify(readAfterRecovery)).not.toContain(TOKEN_C);
  });

  it("requires project-composite task and context pointers at their exact revisions", () => {
    const { alpha, beta } = setup();
    const task = createTask(alpha.id, "alpha task");
    const foreignTask = createTask(beta.id, "beta task");
    const context = createContextConversation(alpha.id, { title: "alpha context", idempotencyKey: "alpha-context" });
    const foreignContext = createContextConversation(beta.id, { title: "beta context", idempotencyKey: "beta-context" });
    const session = register(alpha.id);

    const first = updateCoordinationSnapshot(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "pointer-first"),
      snapshot: { task: task.id },
      snapshotRevision: 1,
      currentTaskId: task.id,
      currentTaskRevision: task.revision,
      contextConversationId: context.id,
      contextRevision: context.revision,
    });
    expect(first.currentTaskId).toBe(task.id);
    expect(first.contextConversationId).toBe(context.id);

    updateTask(alpha.id, task.id, { title: "alpha task revised" }, undefined, { expectedRevision: 0 });
    expectCode(() => updateCoordinationSnapshot(alpha.id, {
      ...lease(MAIN, first, TOKEN_A, "pointer-stale-task"),
      snapshot: { task: task.id },
      snapshotRevision: 2,
      currentTaskId: task.id,
      currentTaskRevision: 0,
      contextConversationId: context.id,
      contextRevision: context.revision,
    }), "POINTER_REVISION_CONFLICT");

    const message = appendContextMessage(alpha.id, context.id, {
      role: "user",
      content: "context revision one",
      expectedRevision: 0,
      idempotencyKey: "alpha-message",
    });
    expectCode(() => updateCoordinationSnapshot(alpha.id, {
      ...lease(MAIN, first, TOKEN_A, "pointer-stale-context"),
      snapshot: { context: context.id },
      snapshotRevision: 2,
      currentTaskId: task.id,
      currentTaskRevision: 1,
      contextConversationId: context.id,
      contextRevision: 0,
    }), "POINTER_REVISION_CONFLICT");
    expectCode(() => updateCoordinationSnapshot(alpha.id, {
      ...lease(MAIN, first, TOKEN_A, "pointer-foreign-task"),
      snapshot: { task: foreignTask.id },
      snapshotRevision: 2,
      currentTaskId: foreignTask.id,
      currentTaskRevision: foreignTask.revision,
      contextConversationId: context.id,
      contextRevision: message.revision,
    }), "POINTER_NOT_FOUND");
    expectCode(() => updateCoordinationSnapshot(alpha.id, {
      ...lease(MAIN, first, TOKEN_A, "pointer-foreign-context"),
      snapshot: { context: foreignContext.id },
      snapshotRevision: 2,
      currentTaskId: task.id,
      currentTaskRevision: 1,
      contextConversationId: foreignContext.id,
      contextRevision: foreignContext.revision,
    }), "POINTER_NOT_FOUND");
  });

  it("keeps exact claim grammar and segment-aware overlap for paths, trees, and reservations", () => {
    expect(parseTaskClaim({ kind: "path", path: "foo" })).toEqual({ kind: "path", path: "foo" });
    expect(parseTaskClaim({ kind: "tree", path: "foo/bar" })).toEqual({ kind: "tree", path: "foo/bar" });
    expect(parseTaskClaim({ kind: "reserved", name: "@build" })).toEqual({ kind: "reserved", name: "@build" });
    expect(parseTaskClaim({ kind: "reserved", name: "@repository" })).toEqual({ kind: "reserved", name: "@repository" });
    for (const invalid of [
      { kind: "path", path: "" },
      { kind: "path", path: "/absolute" },
      { kind: "path", path: "foo/*" },
      { kind: "path", path: "foo/../bar" },
      { kind: "path", path: ".git/config" },
      { kind: "path", path: ".env" },
       { kind: "path", path: "secrets/key" },
       { kind: "path", path: ".ssh/id_ed25519" },
       { kind: "path", path: "config/credentials.json" },
       { kind: "path", path: "keys/id_ed25519" },
       { kind: "path", path: "keys/id_rsa" },
       { kind: "path", path: "keys/id_ecdsa" },
       { kind: "path", path: "keys/id_dsa" },
       { kind: "path", path: "keys/server.key" },
       { kind: "path", path: "keys/private.pem" },
       { kind: "path", path: "keys/server-private.pem" },
       { kind: "path", path: "keys/server.pem" },
       { kind: "path", path: "foo\\bar" },
       { kind: "reserved", name: "@build/output" },
     ]) expect(parseTaskClaim(invalid)).toBeUndefined();
    expect(parseTaskClaim({ kind: "path", path: ".opencode/skills" })).toEqual({ kind: "path", path: ".opencode/skills" });
    expect(parseTaskClaim({ kind: "path", path: ".github/workflows" })).toEqual({ kind: "path", path: ".github/workflows" });
    expect(taskClaimsOverlap({ kind: "path", path: "foo" }, { kind: "path", path: "foobar" })).toBe(false);
    expect(taskClaimsOverlap({ kind: "path", path: "foo/bar" }, { kind: "tree", path: "foo" })).toBe(true);
    expect(taskClaimsOverlap({ kind: "path", path: "foo" }, { kind: "tree", path: "foo/bar" })).toBe(false);
    expect(taskClaimsOverlap({ kind: "reserved", name: "@repository" }, { kind: "path", path: "foo" })).toBe(true);
    expect(taskClaimsOverlap({ kind: "reserved", name: "@build" }, { kind: "path", path: "foo" })).toBe(false);
    expect(taskClaimsOverlap({ kind: "reserved", name: "@build" }, { kind: "reserved", name: "@build" })).toBe(true);

    const { alpha } = setup();
    const session = register(alpha.id);
    const foo = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "claim-foo"),
      clientClaimKey: claimKey("claim-foo"),
      claims: [{ claim: { kind: "path", path: "foo" }, baselineSha256: "a".repeat(64) }],
    });
    const foobar = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, foo.session, TOKEN_A, "claim-foobar"),
      clientClaimKey: claimKey("claim-foobar"),
      claims: [{ claim: { kind: "path", path: "foobar" } }],
    });
    expect(foobar.session.revision).toBe(foo.session.revision + 1);
    expect(status(alpha.id)?.claims).toHaveLength(2);
    expect(JSON.stringify(status(alpha.id))).not.toMatch(/foo|[a-f0-9]{64}/);
    expectCode(() => claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, foobar.session, TOKEN_A, "claim-tree-collision"),
      clientClaimKey: claimKey("claim-tree-collision"),
      claims: [{ claim: { kind: "tree", path: "foo" } }],
    }), "CLAIM_CONFLICT");
  });

  it("rejects self-overlap atomically and leaves no partial claims or receipt", () => {
    const { db, alpha } = setup();
    const session = register(alpha.id);
    expectCode(() => claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "self-overlap"),
      clientClaimKey: claimKey("self-overlap"),
      claims: [
        { claim: { kind: "path", path: "src" } },
        { claim: { kind: "tree", path: "src" } },
      ],
    }), "CLAIM_CONFLICT");
    expect(db.prepare("SELECT count(*) AS count FROM coordination_claims").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT count(*) AS count FROM coordination_mutation_receipts").get()).toEqual({ count: 1 });
    expect(getCoordinationSession(alpha.id, session.id)?.revision).toBe(0);
  });

  it("supports deterministic duplicate receipts, overlap rejection, baseline hashes, and all claim transitions", () => {
    const { db, alpha } = setup();
    const session = register(alpha.id);
    const first = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "duplicate-claim"),
      clientClaimKey: claimKey("duplicate-claim"),
      claims: [{ claim: { kind: "path", path: "one" }, baselineSha256: "b".repeat(64) }],
    });
    expect(claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "duplicate-claim"),
      clientClaimKey: claimKey("duplicate-claim"),
      claims: [{ claim: { kind: "path", path: "one" }, baselineSha256: "b".repeat(64) }],
    })).toEqual(first);
    expectCode(() => claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, first.session, TOKEN_A, "duplicate-claim-changed"),
      clientClaimKey: claimKey("duplicate-claim-changed"),
      claims: [{ claim: { kind: "path", path: "one" }, baselineSha256: "c".repeat(64) }],
    }), "CLAIM_CONFLICT");

    const dirtyClaim = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, first.session, TOKEN_A, "claim-two"),
      clientClaimKey: claimKey("claim-two"),
      claims: [{ claim: { kind: "path", path: "two" } }],
    });
    const dirty = markCoordinationClaims(alpha.id, {
      ...lease(MAIN, dirtyClaim.session, TOKEN_A, "mark-dirty"),
      clientClaimKey: claimKey("duplicate-claim"),
      state: "dirty",
    });
    const quarantinedClaim = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, dirty.session, TOKEN_A, "claim-three"),
      clientClaimKey: claimKey("claim-three"),
      claims: [{ claim: { kind: "path", path: "three" } }],
    });
    const quarantined = markCoordinationClaims(alpha.id, {
      ...lease(MAIN, quarantinedClaim.session, TOKEN_A, "mark-quarantined"),
      clientClaimKey: claimKey("claim-two"),
      state: "quarantined",
    });
    const collisionClaim = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, quarantined.session, TOKEN_A, "claim-four"),
      clientClaimKey: claimKey("claim-four"),
      claims: [{ claim: { kind: "path", path: "four" } }],
    });
    const collision = markCoordinationClaims(alpha.id, {
      ...lease(MAIN, collisionClaim.session, TOKEN_A, "mark-collision"),
      clientClaimKey: claimKey("claim-three"),
      state: "collision",
    });
    const released = releaseCoordinationClaims(alpha.id, {
      ...lease(MAIN, collision.session, TOKEN_A, "release-four"),
      clientClaimKey: claimKey("claim-four"),
    });
    expect(released.session.revision).toBe(collision.session.revision + 1);
    expect(status(alpha.id)?.claims.map((claim) => claim.state).sort())
      .toEqual(["collision", "dirty", "quarantined", "released"]);
    expect(db.prepare("SELECT count(*) AS count FROM coordination_mutation_receipts").get()).toEqual({ count: 9 });
  });

  it("closes by releasing active claims, retaining receipts and the fence allocator", () => {
    const { db, alpha } = setup();
    const session = register(alpha.id);
    const claimed = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "close-claim"),
      clientClaimKey: claimKey("close-claim"),
      claims: [{ claim: { kind: "path", path: "retained" } }],
    });
    const closed = closeCoordinationSession(alpha.id, lease(MAIN, claimed.session, TOKEN_A, "close-session"));
    expect(status(alpha.id)?.session.state).toBe("closed");
    expect(status(alpha.id)?.claims).toEqual([
      expect.objectContaining({ state: "released" }),
    ]);
    expect(db.prepare("SELECT next_fence FROM coordination_worktrees WHERE project_id = ? AND worktree_id = ?")
      .get(alpha.id, MAIN.worktreeId)).toEqual({ next_fence: 2 });
    expect(db.prepare("SELECT count(*) AS count FROM coordination_mutation_receipts WHERE project_id = ?")
      .get(alpha.id)).toEqual({ count: 3 });
    expect(closeCoordinationSession(alpha.id, lease(MAIN, claimed.session, TOKEN_A, "close-session"))).toEqual(closed);

    const next = register(alpha.id, NEXT_INCARCINATION, TOKEN_B, "close-new-incarnation");
    expect(next.fence).toBe(2);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("reads quarantined sessions as inactive and rejects lease mutations", () => {
    const { db, alpha } = setup();
    const session = register(alpha.id);
    db.prepare("UPDATE coordination_sessions SET state = 'quarantined' WHERE id = ?").run(session.id);
    expect(getCoordinationSession(alpha.id, session.id)).toMatchObject({ state: "quarantined" });
    expectCode(() => heartbeatCoordinationSession(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "quarantined-heartbeat"),
      ttlMs: 2_000,
    }), "SESSION_NOT_ACTIVE");
  });

  it("keeps mutation receipts immutable after replay and update attempts", () => {
    const { db, alpha } = setup();
    const session = register(alpha.id);
    const heartbeat = heartbeatCoordinationSession(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "receipt-before-cas"),
      ttlMs: 2_000,
    });
    expect(heartbeat.revision).toBe(1);
    expect(heartbeatCoordinationSession(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "receipt-before-cas"),
      ttlMs: 2_000,
    })).toEqual(heartbeat);
    expectCode(() => heartbeatCoordinationSession(alpha.id, {
      ...lease(MAIN, heartbeat, TOKEN_A, "receipt-before-cas"),
      ttlMs: 3_000,
    }), "IDEMPOTENCY_KEY_REUSED");
    expect(() => db.prepare(
      "UPDATE coordination_mutation_receipts SET operation = 'tampered' WHERE idempotency_key = ?",
    ).run("receipt-before-cas")).toThrow(/immutable/);
  });

  it("publishes sanitized handoffs and consumes each peer event once in sequence", () => {
    const { db, alpha } = setup();
    const first = register(alpha.id);
    const second = register(alpha.id, SECOND_SESSION, TOKEN_B);
    const task = createTask(alpha.id, "opaque handoff task");
    const working = updateCoordinationSnapshot(alpha.id, {
      ...lease(MAIN, first, TOKEN_A, "handoff-task"),
      snapshot: {},
      snapshotRevision: 1,
      currentTaskId: task.id,
      currentTaskRevision: task.revision,
      contextConversationId: null,
      contextRevision: null,
    });
    const published = publishCoordinationHandoff(alpha.id, {
      ...lease(MAIN, working, TOKEN_A, "handoff-publish"),
      operation: "edit",
      path: "packages/ingenium-core/lib/tools/coordination.ts",
      baselineSha256: "a".repeat(64),
    });

    expect(published.event).toMatchObject({
      sequence: 1,
      operation: "edit",
      path: "packages/ingenium-core/lib/tools/coordination.ts",
      baselineSha256: "a".repeat(64),
      sourceActorId: expect.stringMatching(/^actor-[0-9a-f]{64}$/),
      sourceIncarnation: MAIN.incarnation,
      sourceRevision: published.session.revision,
      currentTaskId: `task-${createHash("sha256").update(task.id).digest("hex")}`,
    });
    const consumed = consumeCoordinationHandoffs(alpha.id, {
      ...lease(SECOND_SESSION, second, TOKEN_B, "handoff-consume"),
    });
    expect(consumed.events).toEqual([published.event]);
    const replay = consumeCoordinationHandoffs(alpha.id, {
      ...lease(SECOND_SESSION, second, TOKEN_B, "handoff-consume"),
    });
    expect(replay).toEqual(consumed);
    const injectionLike = publishCoordinationHandoff(alpha.id, {
      ...lease(MAIN, published.session, TOKEN_A, "handoff-publish-encoded-path"),
      operation: "write",
      path: "src/<system>[override](command)</system>.ts",
    });
    const injectionLikeConsumed = consumeCoordinationHandoffs(alpha.id, {
      ...lease(SECOND_SESSION, consumed.session, TOKEN_B, "handoff-consume-encoded-path"),
    });
    expect(injectionLikeConsumed.events).toEqual([injectionLike.event]);
    const empty = consumeCoordinationHandoffs(alpha.id, {
      ...lease(SECOND_SESSION, injectionLikeConsumed.session, TOKEN_B, "handoff-consume-empty"),
    });
    expect(empty.events).toEqual([]);
    expect(empty.session.revision).toBe(injectionLikeConsumed.session.revision);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("stores bounded operational memory and advances handoffs only after acknowledgement", () => {
    const { db, alpha } = setup();
    const memory = ensureCoordinationMemory(alpha.id, MAIN.worktreeId);
    const sourceRegistration = {
      ...MAIN,
      ownershipToken: TOKEN_A,
      ttlMs: 2_000,
      idempotencyKey: "memory-source-register",
      contextConversationId: memory.id,
      contextRevision: memory.revision,
    };
    const source = registerCoordinationSession(alpha.id, sourceRegistration);
    const receiver = registerCoordinationSession(alpha.id, {
      ...SECOND_SESSION,
      ownershipToken: TOKEN_B,
      ttlMs: 2_000,
      idempotencyKey: "memory-receiver-register",
      contextConversationId: memory.id,
      contextRevision: memory.revision,
    });
    expect(source.contextConversationId).toBeTruthy();
    expect(receiver.contextConversationId).toBe(source.contextConversationId);

    const published = publishCoordinationHandoff(alpha.id, {
      ...lease(MAIN, source, TOKEN_A, "memory-publish"),
      operation: "edit",
      path: "src/customer-file.ts",
      baselineSha256: "a".repeat(64),
    });
    expect(published.event).toMatchObject({
      contextConversationId: source.contextConversationId,
      contextRevision: 1,
    });
    expect(registerCoordinationSession(alpha.id, {
      ...sourceRegistration,
      contextRevision: published.event.contextRevision!,
    })).toEqual(source);
    const memoryRow = db.prepare(
      "SELECT content, metadata FROM context_messages WHERE project_id = ? AND conversation_id = ?",
    ).get(alpha.id, source.contextConversationId) as { content: string; metadata: string };
    expect(JSON.parse(memoryRow.metadata)).toEqual({
      kind: "coordination_handoff_receipt",
      version: 1,
      eventId: published.event.eventId,
    });
    const content = JSON.parse(memoryRow.content) as Record<string, unknown>;
    expect(content).toMatchObject({ version: 1, type: "handoff_receipt", operation: "edit", sequence: 1 });
    expect(memoryRow.content).not.toContain("customer-file.ts");
    expect(memoryRow.content).not.toContain(TOKEN_A);

    const read = readCoordinationHandoffs(alpha.id, {
      ...lease(SECOND_SESSION, receiver, TOKEN_B, "unused-read-key"),
    });
    expect(read.events).toEqual([published.event]);
    expect(read.acknowledgementRequired).toBe(true);
    expect(read.session.revision).toBe(receiver.revision);
    expect(readCoordinationHandoffs(alpha.id, {
      ...lease(SECOND_SESSION, receiver, TOKEN_B, "unused-read-key-replay"),
    }).events).toEqual([published.event]);

    const acknowledged = acknowledgeCoordinationHandoffs(alpha.id, {
      ...lease(SECOND_SESSION, receiver, TOKEN_B, "memory-ack"),
      throughSequence: read.throughSequence,
    });
    expect(readCoordinationHandoffs(alpha.id, {
      ...lease(SECOND_SESSION, acknowledged, TOKEN_B, "unused-read-key-empty"),
    })).toMatchObject({ events: [], acknowledgementRequired: false });

    const closed = closeCoordinationSession(alpha.id, {
      ...lease(SECOND_SESSION, acknowledged, TOKEN_B, "memory-close"),
    });
    expect(closed.state).toBe("closed");
    const restartedIdentity = { ...SECOND_SESSION, incarnation: SECOND_SESSION.incarnation + 1 };
    const restarted = register(alpha.id, restartedIdentity, TOKEN_C, "memory-restart");
    expect(readCoordinationHandoffs(alpha.id, {
      ...lease(restartedIdentity, restarted, TOKEN_C, "unused-read-key-restarted"),
    })).toMatchObject({ events: [], acknowledgementRequired: false });
  });

  it("starts strict numeric memory independently of legacy nullable entries", () => {
    const { alpha } = setup();
    const legacy = createContextConversation(alpha.id, {
      title: "Coordination operational memory",
      metadata: { kind: "coordination_operational_memory", version: 1, worktreeId: MAIN.worktreeId },
      idempotencyKey: `coordination-memory-${createHash("sha256").update(MAIN.worktreeId).digest("hex")}`,
    });
    appendContextMessage(alpha.id, legacy.id, {
      role: "assistant",
      content: JSON.stringify({ version: 1, type: "operational", contextRevision: null }),
      expectedRevision: 0,
      idempotencyKey: "legacy-nullable-memory",
      metadata: { kind: "coordination_operational_entry", version: 1 },
    });

    const memory = ensureCoordinationMemory(alpha.id, MAIN.worktreeId);

    expect({ ...memory, metadata: JSON.parse(memory.metadata) }).toMatchObject({ revision: 0, metadata: {
      kind: "coordination_operational_memory", version: 2, worktreeId: MAIN.worktreeId,
    } });
    expect(memory.id).not.toBe(legacy.id);
  });

  it("appends exact-schema operational entries without lost updates and replays them after restart", () => {
    const { db, alpha } = setup();
    const coordinationMemory = ensureCoordinationMemory(alpha.id, MAIN.worktreeId);
    const first = registerCoordinationSession(alpha.id, {
      ...MAIN, ownershipToken: TOKEN_A, ttlMs: 2_000, idempotencyKey: "typed-memory-first-register",
      contextConversationId: coordinationMemory.id, contextRevision: coordinationMemory.revision,
    });
    const second = registerCoordinationSession(alpha.id, {
      ...SECOND_SESSION, ownershipToken: TOKEN_B, ttlMs: 2_000, idempotencyKey: "typed-memory-second-register",
      contextConversationId: coordinationMemory.id, contextRevision: coordinationMemory.revision,
    });
    const entry = {
      status: "idle" as const,
      actions: [{
        kind: "edit" as const,
        result: "succeeded" as const,
        pathSegments: [Buffer.from("src").toString("base64url"), Buffer.from("safe.ts").toString("base64url")],
        targetHash: null,
      }],
      checks: [{ kind: "typecheck" as const, result: "passed" as const, targetHash: "a".repeat(64) }],
      todos: { total: 1, pending: 0, inProgress: 0, completed: 1, cancelled: 0, state: "complete" as const },
      currentTaskId: `task-${"b".repeat(64)}`,
      changedPaths: [{
        pathSegments: [Buffer.from("src").toString("base64url"), Buffer.from("safe.ts").toString("base64url")],
        operation: "edit" as const,
        additions: 2,
        deletions: 1,
        changeRevision: 1,
      }],
      nextWork: { kind: "review_changes" as const, referenceHash: "c".repeat(64) },
    };
    const firstInput = { ...lease(MAIN, first, TOKEN_A, "typed-memory-first"), entry };
    const firstPublished = publishCoordinationMemory(alpha.id, firstInput);
    const secondPublished = publishCoordinationMemory(alpha.id, {
      ...lease(SECOND_SESSION, second, TOKEN_B, "typed-memory-second"),
      entry: { ...entry, status: "working", currentTaskId: null },
    });

    expect(publishCoordinationMemory(alpha.id, firstInput)).toEqual(firstPublished);
    const memory = readCoordinationMemory(alpha.id, MAIN.worktreeId);
    expect(memory.revision).toBe(2);
    expect(memory.entries).toHaveLength(2);
    expect(memory.entries.map((item) => item.entryId)).toEqual([
      firstPublished.memory.entry.entryId,
      secondPublished.memory.entry.entryId,
    ]);
    expect(memory.entries.map((item) => item.contextRevision)).toEqual([0, 1]);
    expect(firstPublished.memory.entry.contextRevision).toBe(0);
    expect(secondPublished.memory.entry.contextRevision).toBe(1);
    expect(memory.entries[0]).toMatchObject(entry);
    expect(memory.entries[0]?.actorId).toMatch(/^actor-[0-9a-f]{64}$/);
    expect(JSON.stringify(memory)).not.toContain(MAIN.sessionId);
    expect(JSON.stringify(memory)).not.toContain(TOKEN_A);
    expect(db.prepare("SELECT count(*) AS count FROM context_messages WHERE conversation_id = ?")
      .get(memory.conversationId)).toEqual({ count: 2 });

    const restartedIdentity = { ...MAIN, incarnation: MAIN.incarnation + 1 };
    register(alpha.id, restartedIdentity, TOKEN_C, "typed-memory-restart");
    expect(readCoordinationMemory(alpha.id, MAIN.worktreeId)).toEqual(memory);

    expectCode(() => publishCoordinationMemory(alpha.id, {
      ...lease(MAIN, firstPublished.session, TOKEN_A, "typed-memory-extra-key"),
      entry: { ...entry, rawCommand: "do not persist" } as typeof entry,
    }), "INVALID_COORDINATION_INPUT");
    expectCode(() => publishCoordinationMemory(alpha.id, {
      ...lease(MAIN, firstPublished.session, TOKEN_A, "typed-memory-caller-revision"),
      entry: { ...entry, contextRevision: null } as typeof entry,
    }), "INVALID_COORDINATION_INPUT");
    expectCode(() => publishCoordinationMemory(alpha.id, {
      ...lease(MAIN, firstPublished.session, TOKEN_A, "typed-memory-raw-path"),
      entry: {
        ...entry,
        actions: [{ kind: "edit", result: "succeeded", pathSegments: ["src/private.ts"], targetHash: null }],
      },
    }), "INVALID_COORDINATION_INPUT");

    const persisted = db.prepare(
      "SELECT id, content FROM context_messages WHERE conversation_id = ? ORDER BY sequence DESC LIMIT 1",
    ).get(memory.conversationId) as { id: string; content: string };
    const malformed = { ...JSON.parse(persisted.content), contextRevision: null };
    db.prepare(
      `INSERT INTO context_messages
       (id, project_id, conversation_id, sequence, role, content, content_hash, request_hash,
        idempotency_key, tags, priority, metadata, created_at)
       SELECT ?, project_id, conversation_id, sequence + 1, role, ?, content_hash, request_hash,
              NULL, tags, priority, metadata, created_at
       FROM context_messages WHERE id = ?`,
    ).run("00000000-0000-4000-8000-000000000099", JSON.stringify(malformed), persisted.id);
    expectCode(() => readCoordinationMemory(alpha.id, MAIN.worktreeId), "COORDINATION_INTEGRITY_ERROR");
  });

  it("reads and acknowledges live peer memory after registration with durable restart replay", () => {
    const { alpha, beta } = setup();
    const memory = ensureCoordinationMemory(alpha.id, MAIN.worktreeId);
    let source = registerCoordinationSession(alpha.id, {
      ...MAIN, ownershipToken: TOKEN_A, ttlMs: 2_000, idempotencyKey: "live-memory-source-register",
      contextConversationId: memory.id, contextRevision: memory.revision,
    });
    const receiver = registerCoordinationSession(alpha.id, {
      ...SECOND_SESSION, ownershipToken: TOKEN_B, ttlMs: 2_000, idempotencyKey: "live-memory-receiver-register",
      contextConversationId: memory.id, contextRevision: memory.revision,
    });
    const entry = {
      status: "working" as const,
      actions: [{ kind: "edit" as const, result: "succeeded" as const,
        pathSegments: [Buffer.from("src").toString("base64url"), Buffer.from("live.ts").toString("base64url")], targetHash: null }],
      checks: [{ kind: "test" as const, result: "passed" as const, targetHash: "a".repeat(64) }],
      todos: { total: 1, pending: 0, inProgress: 1, completed: 0, cancelled: 0, state: "in_progress" as const },
      currentTaskId: null,
      changedPaths: [],
      nextWork: { kind: "continue_task" as const, referenceHash: "b".repeat(64) },
    };
    const otherIdentity = { ...OTHER_WORKTREE, sessionId: "other-source" };
    const otherMemory = ensureCoordinationMemory(alpha.id, otherIdentity.worktreeId);
    const other = registerCoordinationSession(alpha.id, {
      ...otherIdentity, ownershipToken: TOKEN_C, ttlMs: 2_000, idempotencyKey: "live-memory-other-register",
      contextConversationId: otherMemory.id, contextRevision: otherMemory.revision,
    });
    publishCoordinationMemory(alpha.id, {
      ...lease(otherIdentity, other, TOKEN_C, "live-memory-other-publish"), entry,
    });
    const betaIdentity = { ...MAIN, sessionId: "beta-source" };
    const betaMemory = ensureCoordinationMemory(beta.id, betaIdentity.worktreeId);
    const betaSource = registerCoordinationSession(beta.id, {
      ...betaIdentity, ownershipToken: TOKEN_D, ttlMs: 2_000, idempotencyKey: "live-memory-beta-register",
      contextConversationId: betaMemory.id, contextRevision: betaMemory.revision,
    });
    publishCoordinationMemory(beta.id, {
      ...lease(betaIdentity, betaSource, TOKEN_D, "live-memory-beta-publish"), entry,
    });
    const first = publishCoordinationMemory(alpha.id, {
      ...lease(MAIN, source, TOKEN_A, "live-memory-first"), entry,
    });
    source = first.session;

    const unseen = readCoordinationMemoryUpdates(alpha.id, {
      ...lease(SECOND_SESSION, receiver, TOKEN_B, "live-memory-read"), limit: 8,
    });
    expect(unseen.memory).toMatchObject({
      revision: 1,
      throughRevision: 1,
      acknowledgementRequired: true,
      entries: [{ entryId: first.memory.entry.entryId, contextRevision: 0, ...entry }],
    });
    const acknowledged = acknowledgeCoordinationMemory(alpha.id, {
      ...lease(SECOND_SESSION, receiver, TOKEN_B, "live-memory-ack"),
      throughRevision: unseen.memory.throughRevision,
    });
    expect(readCoordinationMemoryUpdates(alpha.id, {
      ...lease(SECOND_SESSION, acknowledged, TOKEN_B, "live-memory-empty"),
    }).memory).toMatchObject({ entries: [], acknowledgementRequired: false });
    expect(readCoordinationMemoryUpdates(alpha.id, {
      ...lease(MAIN, source, TOKEN_A, "live-memory-self"),
    }).memory.entries).toEqual([]);

    const second = publishCoordinationMemory(alpha.id, {
      ...lease(MAIN, source, TOKEN_A, "live-memory-second"), entry: { ...entry, status: "idle" },
    });
    source = second.session;
    const pending = readCoordinationMemoryUpdates(alpha.id, {
      ...lease(SECOND_SESSION, acknowledged, TOKEN_B, "live-memory-pending"),
    });
    expect(pending.memory.entries.map(({ entryId }) => entryId)).toEqual([second.memory.entry.entryId]);
    closeCoordinationSession(alpha.id, {
      ...lease(SECOND_SESSION, acknowledged, TOKEN_B, "live-memory-close"),
    });
    const restartedIdentity = { ...SECOND_SESSION, incarnation: 2 };
    const restarted = registerCoordinationSession(alpha.id, {
      ...restartedIdentity, ownershipToken: TOKEN_C, ttlMs: 2_000, idempotencyKey: "live-memory-restart",
      contextConversationId: memory.id, contextRevision: second.memory.revision,
    });
    const replay = readCoordinationMemoryUpdates(alpha.id, {
      ...lease(restartedIdentity, restarted, TOKEN_C, "live-memory-restart-read"),
    });
    expect(replay.memory.entries.map(({ entryId }) => entryId)).toEqual([second.memory.entry.entryId]);

    expectCode(() => readCoordinationMemoryUpdates(alpha.id, {
      ...lease(restartedIdentity, restarted, TOKEN_C, "live-memory-limit"), limit: 9,
    }), "INVALID_COORDINATION_INPUT");
    for (let index = 0; index < 7; index += 1) {
      const published = publishCoordinationMemory(alpha.id, {
        ...lease(MAIN, source, TOKEN_A, `live-memory-bounded-${index}`), entry: { ...entry, status: "working" },
      });
      source = published.session;
    }
    const boundedIdentity = { ...SECOND_SESSION, sessionId: "session-bounded" };
    const bounded = registerCoordinationSession(alpha.id, {
      ...boundedIdentity, ownershipToken: TOKEN_D, ttlMs: 2_000, idempotencyKey: "live-memory-bounded-register",
      contextConversationId: memory.id, contextRevision: 9,
    });
    expect(readCoordinationMemoryUpdates(alpha.id, {
      ...lease(boundedIdentity, bounded, TOKEN_D, "live-memory-bounded-read"), limit: 8,
    }).memory.entries).toHaveLength(8);
  });

  it("projects only typed active same-worktree peer snapshots", () => {
    const { db, alpha } = setup();
    const source = register(alpha.id);
    const receiver = register(alpha.id, SECOND_SESSION, TOKEN_B);
    updateCoordinationSnapshot(alpha.id, {
      ...lease(MAIN, source, TOKEN_A, "peer-snapshot-update"),
      snapshot: {
        version: 1,
        status: "working",
        todos: { pending: 1, inProgress: 1, completed: 2, cancelled: 0 },
        changedPaths: [{ path: "src/peer.ts", operation: "edit", additions: 3, deletions: 1, changeRevision: 1 }],
        currentTaskId: `task-${"a".repeat(64)}`,
        contextRevision: 8,
      },
      snapshotRevision: 1,
      currentTaskId: null,
      currentTaskRevision: null,
      contextConversationId: null,
      contextRevision: null,
    });

    const receiverStatus = status(alpha.id, SECOND_SESSION, TOKEN_B)!;
    expect(receiverStatus.peers).toMatchObject([{
      peerId: expect.stringMatching(/^peer-[0-9a-f]{64}$/),
      status: "working",
      todos: { total: 4, pending: 1, inProgress: 1, completed: 2, cancelled: 0, state: "mixed" },
      changedPaths: [{ path: "src/peer.ts", operation: "edit", additions: 3, deletions: 1, changeRevision: 1 }],
      currentTaskId: `task-${"a".repeat(64)}`,
      contextRevision: 8,
    }]);
    expect(JSON.stringify(receiverStatus.peers)).not.toContain(MAIN.sessionId);

    db.prepare("UPDATE coordination_sessions SET expires_at = ? WHERE session_id = ?")
      .run("2000-01-01T00:00:00.000Z", MAIN.sessionId);
    expect(status(alpha.id, SECOND_SESSION, TOKEN_B)!.peers).toEqual([]);
    expect(receiver.state).toBe("active");
  });

  it("isolates handoffs by project and worktree and rejects unsafe paths or stale ownership", () => {
    const { alpha, beta } = setup();
    const source = register(alpha.id);
    const peer = register(alpha.id, SECOND_SESSION, TOKEN_B);
    const otherWorktree = register(alpha.id, OTHER_WORKTREE, TOKEN_C);
    const otherProject = register(beta.id, SECOND_SESSION, TOKEN_D);

    expectCode(() => publishCoordinationHandoff(alpha.id, {
      ...lease(MAIN, source, TOKEN_A, "handoff-absolute"),
      operation: "write",
      path: "/private/source.ts",
    }), "INVALID_COORDINATION_INPUT");
    for (const [index, path] of [
      "../escape.ts",
      "src/control\u0000.ts",
      `src/${"a".repeat(256)}.ts`,
    ].entries()) {
      expectCode(() => publishCoordinationHandoff(alpha.id, {
        ...lease(MAIN, source, TOKEN_A, `handoff-injection-${index}`),
        operation: "write",
        path,
      }), "INVALID_COORDINATION_INPUT");
    }
    expectCode(() => publishCoordinationHandoff(alpha.id, {
      ...lease(MAIN, source, TOKEN_B, "handoff-wrong-owner"),
      operation: "write",
      path: "safe/source.ts",
    }), "OWNERSHIP_TOKEN_MISMATCH");
    const published = publishCoordinationHandoff(alpha.id, {
      ...lease(MAIN, source, TOKEN_A, "handoff-isolated"),
      operation: "write",
      path: "safe/source.ts",
    });
    expect(consumeCoordinationHandoffs(alpha.id, {
      ...lease(SECOND_SESSION, peer, TOKEN_B, "handoff-peer"),
    }).events).toEqual([published.event]);
    expect(consumeCoordinationHandoffs(alpha.id, {
      ...lease(OTHER_WORKTREE, otherWorktree, TOKEN_C, "handoff-other-worktree"),
    }).events).toEqual([]);
    expect(consumeCoordinationHandoffs(beta.id, {
      ...lease(SECOND_SESSION, otherProject, TOKEN_D, "handoff-other-project"),
    }).events).toEqual([]);
  });

  it("derives stable opaque worktree identities without exposing launcher paths", () => {
    const storageMappingHash = createHash("sha256").update("workspace-alpha\0/home/user/private/repository").digest("hex");
    const id = coordinationWorktreeId("workspace-alpha", storageMappingHash);
    expect(id).toMatch(/^worktree-[0-9a-f]{64}$/);
    expect(id).toBe(coordinationWorktreeId("workspace-alpha", storageMappingHash));
    expect(id).not.toContain("home");
  });

  it("fails closed when the coordination handoff migration is partial", () => {
    const { db } = setup();
    const path = process.env.INGENIUM_CORE_DB_PATH!;
    db.exec("DROP INDEX idx_coordination_handoff_cursors_worktree");
    resetDbForTest();
    expect(() => getDb(path)).toThrow(/Migration 107 is in a PARTIAL state/);
  });

  it("verifies managed baselines and quarantines an unexpected footprint", () => {
    const { db, alpha } = setup();
    const registered = register(alpha.id);
    const firstKey = claimKey("managed-create");
    const claimed = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, registered, TOKEN_A, "managed-create-claim"),
      clientClaimKey: firstKey,
      operation: "create",
      claims: [{
        claim: { kind: "path", path: "src/managed.ts" },
        baselineSha256: null,
        currentSha256: null,
        repositorySha256: null,
      }],
    });
    expect(claimed).toMatchObject({ acceptedEpoch: 1, manifestGeneration: 0, operationId: expect.any(String) });
    const proof = {
      ...lease(MAIN, claimed.session, TOKEN_A, "managed-create-verify"),
      clientClaimKey: firstKey,
      acceptedEpoch: claimed.acceptedEpoch,
    };
    expect(verifyCoordinationClaims(alpha.id, proof).acceptedEpoch).toBe(1);
    const acceptedHash = "a".repeat(64);
    const completed = completeManagedMutation(alpha.id, {
      ...proof,
      operationId: claimed.operationId!,
      operation: "create",
      footprint: [{
        path: "src/managed.ts",
        pathSha256: createHash("sha256").update("src/managed.ts").digest("hex"),
        beforeSha256: null,
        afterSha256: acceptedHash,
      }],
    });
    expect(db.prepare(
      "SELECT accepted_sha256, accepted_epoch FROM coordination_managed_paths WHERE project_id = ? AND worktree_id = ? AND path = ?",
    ).get(alpha.id, MAIN.worktreeId, "src/managed.ts")).toEqual({ accepted_sha256: acceptedHash, accepted_epoch: 1 });

    const secondKey = claimKey("managed-edit");
    const editing = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, completed.session, TOKEN_A, "managed-edit-claim"),
      clientClaimKey: secondKey,
      operation: "edit",
      claims: [{
        claim: { kind: "path", path: "src/managed.ts" },
        baselineSha256: acceptedHash,
        currentSha256: acceptedHash,
        repositorySha256: null,
      }],
    });
    expectCode(() => completeManagedMutation(alpha.id, {
      ...lease(MAIN, editing.session, TOKEN_A, "managed-edit-complete"),
      clientClaimKey: secondKey,
      acceptedEpoch: editing.acceptedEpoch,
      operationId: editing.operationId!,
      operation: "edit",
      footprint: [{
        path: "src/unclaimed.ts",
        pathSha256: createHash("sha256").update("src/unclaimed.ts").digest("hex"),
        beforeSha256: null,
        afterSha256: "b".repeat(64),
      }],
    }), "FOOTPRINT_MISMATCH");
    expect(db.prepare(
      "SELECT state, quarantine_code FROM coordination_worktree_epochs WHERE project_id = ? AND worktree_id = ?",
    ).get(alpha.id, MAIN.worktreeId)).toEqual({ state: "quarantined", quarantine_code: "unexpected_footprint" });
    expect(status(alpha.id)?.session.state).toBe("quarantined");
  });

  it("keeps accepted baselines authoritative and rejects stale or mismatched claims atomically", () => {
    const { db, alpha } = setup();
    const session = register(alpha.id);
    const oldHash = "1".repeat(64);
    const repositoryHash = "2".repeat(64);
    const paths = ["src/authoritative.ts", "src/forged.ts", "src/dirty.ts", "src/missing.ts", "src/stale-epoch.ts", "src/concurrent.ts"];
    const insert = db.prepare(
      `INSERT INTO coordination_managed_paths
       (project_id, worktree_id, path, accepted_sha256, accepted_epoch, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const path of paths) insert.run(alpha.id, MAIN.worktreeId, path, oldHash, path === "src/stale-epoch.ts" ? 2 : 1, "now");

    const key = claimKey("authoritative-baseline");
    const claimed = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "authoritative-baseline"),
      clientClaimKey: key,
      operation: "edit",
      claims: [{
        claim: { kind: "path", path: "src/authoritative.ts" },
        baselineSha256: oldHash,
        currentSha256: oldHash,
        repositorySha256: repositoryHash,
      }],
    });
    const completed = completeManagedMutation(alpha.id, {
      ...lease(MAIN, claimed.session, TOKEN_A, "authoritative-baseline-complete"),
      clientClaimKey: key,
      acceptedEpoch: claimed.acceptedEpoch,
      operationId: claimed.operationId!,
      operation: "edit",
      footprint: [],
    });
    expect(db.prepare(
      "SELECT accepted_sha256, accepted_epoch FROM coordination_managed_paths WHERE project_id = ? AND worktree_id = ? AND path = ?",
    ).get(alpha.id, MAIN.worktreeId, "src/authoritative.ts")).toEqual({ accepted_sha256: oldHash, accepted_epoch: 1 });
    expect(db.prepare(
      "SELECT state FROM coordination_managed_operations WHERE id = ?",
    ).get(claimed.operationId)).toEqual({ state: "verified" });
    expect(db.prepare(
      "SELECT operation FROM coordination_mutation_receipts WHERE project_id = ? AND idempotency_key = ?",
    ).get(alpha.id, "authoritative-baseline")).toEqual({ operation: "claim_batch" });

    for (const [idempotencyKey, path, currentSha256, repositorySha256] of [
      ["forged-repository-baseline", "src/forged.ts", repositoryHash, repositoryHash],
      ["dirty-baseline", "src/dirty.ts", "3".repeat(64), repositoryHash],
      ["missing-baseline", "src/missing.ts", null, null],
      ["stale-accepted-epoch", "src/stale-epoch.ts", oldHash, repositoryHash],
    ] as const) {
      expectCode(() => claimCoordinationBatch(alpha.id, {
        ...lease(MAIN, completed.session, TOKEN_A, idempotencyKey),
        clientClaimKey: claimKey(idempotencyKey),
        operation: "edit",
        claims: [{
          claim: { kind: "path", path },
          baselineSha256: currentSha256,
          currentSha256,
          repositorySha256,
        }],
      }), "BASELINE_MISMATCH");
    }
    expectCode(() => claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, completed.session, TOKEN_A, "foreign-scope-baseline"),
      worktreeId: OTHER_WORKTREE.worktreeId,
      clientClaimKey: claimKey("foreign-scope-baseline"),
      operation: "edit",
      claims: [{
        claim: { kind: "path", path: "src/authoritative.ts" },
        baselineSha256: oldHash,
        currentSha256: oldHash,
        repositorySha256: repositoryHash,
      }],
    }), "SESSION_NOT_FOUND");

    const peer = register(alpha.id, SECOND_SESSION, TOKEN_B, "concurrent-peer-register");
    claimCoordinationBatch(alpha.id, {
      ...lease(SECOND_SESSION, peer, TOKEN_B, "concurrent-repository-claim"),
      clientClaimKey: claimKey("concurrent-repository-claim"),
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    });
    expectCode(() => claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, completed.session, TOKEN_A, "concurrent-baseline"),
      clientClaimKey: claimKey("concurrent-baseline"),
      operation: "edit",
      claims: [{
        claim: { kind: "path", path: "src/concurrent.ts" },
        baselineSha256: oldHash,
        currentSha256: oldHash,
        repositorySha256: repositoryHash,
      }],
    }), "CLAIM_CONFLICT");
    expect(db.prepare(
      "SELECT accepted_sha256 FROM coordination_managed_paths WHERE project_id = ? AND worktree_id = ? AND path = ?",
    ).get(alpha.id, MAIN.worktreeId, "src/concurrent.ts")).toEqual({ accepted_sha256: oldHash });
    expect(db.prepare(
      "SELECT count(*) AS count FROM coordination_mutation_receipts WHERE project_id = ? AND idempotency_key IN (?, ?, ?, ?, ?, ?)",
    ).get(
      alpha.id, "forged-repository-baseline", "dirty-baseline", "missing-baseline", "stale-accepted-epoch",
      "foreign-scope-baseline", "concurrent-baseline",
    )).toEqual({ count: 0 });
  });

  it("recovers only an exactly reconciled quarantined owner and fences its old claims", () => {
    const { db, alpha } = setup();
    const crashed = register(alpha.id);
    const crashedKey = claimKey("crashed-epoch-claims");
    const claimed = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, crashed, TOKEN_A, "crashed-epoch-claim"),
      clientClaimKey: crashedKey,
      claims: [
        { claim: { kind: "path", path: "src/crashed.ts" } },
        { claim: { kind: "reserved", name: "@build" } },
      ],
    });
    quarantineCoordinationClaims(alpha.id, {
      ...lease(MAIN, claimed.session, TOKEN_A, "crashed-epoch-quarantine"),
      clientClaimKey: crashedKey,
      acceptedEpoch: claimed.acceptedEpoch,
    });
    const successor = register(alpha.id, SECOND_SESSION, TOKEN_B, "recovery-successor-register");
    const recoveryState = getCoordinationEpochRecoveryState(alpha.id, {
      ...lease(SECOND_SESSION, successor, TOKEN_B, "recovery-state"),
    });
    expect(recoveryState).toMatchObject({
      acceptedEpoch: claimed.acceptedEpoch,
      quarantineCode: "uncertain_apply",
      reconciliationRecorded: false,
    });
    const recoveryProof = {
      quarantinedSessionId: recoveryState.quarantinedSessionId,
      quarantinedIncarnation: recoveryState.quarantinedIncarnation,
      quarantinedFence: recoveryState.quarantinedFence,
      quarantinedActorId: recoveryState.quarantinedActorId,
      acceptedEpoch: recoveryState.acceptedEpoch,
    };

    expectCode(() => reconcileCoordinationEpoch(alpha.id, {
      ...lease(SECOND_SESSION, successor, TOKEN_B, "foreign-reconciliation"),
      ...recoveryProof,
      quarantinedSessionId: SECOND_SESSION.sessionId,
      quarantinedIncarnation: SECOND_SESSION.incarnation,
      quarantinedFence: successor.fence,
      quarantinedActorId: successor.actorId,
      recoveryFootprintHash: "a".repeat(64),
    }), "CLAIM_CONFLICT");
    const reconciled = reconcileCoordinationEpoch(alpha.id, {
      ...lease(SECOND_SESSION, successor, TOKEN_B, "exact-reconciliation"),
      ...recoveryProof,
      recoveryFootprintHash: "a".repeat(64),
    });
    expectCode(() => recoverCoordinationEpoch(alpha.id, {
      ...lease(SECOND_SESSION, reconciled.session, TOKEN_B, "dirty-recovery"),
      ...recoveryProof,
      recoveryFootprintHash: "b".repeat(64),
    }), "FOOTPRINT_MISMATCH");
    const recovered = recoverCoordinationEpoch(alpha.id, {
      ...lease(SECOND_SESSION, reconciled.session, TOKEN_B, "exact-recovery"),
      ...recoveryProof,
      recoveryFootprintHash: "a".repeat(64),
    });

    expect(recovered.acceptedEpoch).toBe(claimed.acceptedEpoch + 1);
    expect(recovered.session.fence).toBeGreaterThan(successor.fence);
    expect(db.prepare(
      "SELECT state, released_at FROM coordination_claims WHERE project_id = ? AND coordination_session_id = ? ORDER BY kind",
    ).all(alpha.id, crashed.id)).toEqual([
      { state: "released", released_at: expect.any(String) },
      { state: "released", released_at: expect.any(String) },
    ]);
    const closedOwner = getCoordinationSession(alpha.id, crashed.id)!;
    expect(closedOwner.state).toBe("closed");
    expectCode(() => verifyCoordinationClaims(alpha.id, {
      ...lease(MAIN, closedOwner, TOKEN_A, "stale-old-claim"),
      clientClaimKey: crashedKey,
      acceptedEpoch: claimed.acceptedEpoch,
    }), "SESSION_CLOSED");

    const successorClaim = claimCoordinationBatch(alpha.id, {
      ...lease(SECOND_SESSION, recovered.session, TOKEN_B, "successor-claim"),
      clientClaimKey: claimKey("successor-claim"),
      claims: [
        { claim: { kind: "path", path: "src/crashed.ts" } },
        { claim: { kind: "reserved", name: "@build" } },
      ],
    });
    expect(successorClaim.acceptedEpoch).toBe(recovered.acceptedEpoch);
  });

  it("denies recovery while the quarantined epoch owner is live or foreign claims remain", () => {
    const { db, alpha } = setup();
    const owner = register(alpha.id);
    const ownerKey = claimKey("recovery-owner");
    const ownerClaim = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, owner, TOKEN_A, "recovery-owner-claim"),
      clientClaimKey: ownerKey,
      claims: [{ claim: { kind: "path", path: "src/owner.ts" } }],
    });
    const foreign = register(alpha.id, SECOND_SESSION, TOKEN_B, "recovery-foreign-register");
    const foreignClaim = claimCoordinationBatch(alpha.id, {
      ...lease(SECOND_SESSION, foreign, TOKEN_B, "recovery-foreign-claim"),
      clientClaimKey: claimKey("recovery-foreign"),
      claims: [{ claim: { kind: "path", path: "src/foreign.ts" } }],
    });
    const proof = {
      quarantinedSessionId: MAIN.sessionId,
      quarantinedIncarnation: MAIN.incarnation,
      quarantinedFence: ownerClaim.session.fence,
      quarantinedActorId: ownerClaim.session.actorId,
      acceptedEpoch: ownerClaim.acceptedEpoch,
      recoveryFootprintHash: "c".repeat(64),
    };
    db.prepare(
      `UPDATE coordination_worktree_epochs
       SET state = 'quarantined', quarantine_code = 'uncertain_apply',
           quarantined_coordination_session_id = ?, quarantined_incarnation = ?, quarantined_fence = ?
       WHERE project_id = ? AND worktree_id = ?`,
    ).run(owner.id, MAIN.incarnation, ownerClaim.session.fence, alpha.id, MAIN.worktreeId);
    expectCode(() => reconcileCoordinationEpoch(alpha.id, {
      ...lease(SECOND_SESSION, foreignClaim.session, TOKEN_B, "live-owner-reconciliation"), ...proof,
    }), "CLAIM_CONFLICT");

    quarantineCoordinationClaims(alpha.id, {
      ...lease(MAIN, ownerClaim.session, TOKEN_A, "recovery-owner-quarantine"),
      clientClaimKey: ownerKey,
      acceptedEpoch: ownerClaim.acceptedEpoch,
    });
    const foreignSession = getCoordinationSession(alpha.id, foreign.id)!;
    const reconciled = reconcileCoordinationEpoch(alpha.id, {
      ...lease(SECOND_SESSION, foreignSession, TOKEN_B, "foreign-claim-reconciliation"), ...proof,
    });
    expectCode(() => recoverCoordinationEpoch(alpha.id, {
      ...lease(SECOND_SESSION, reconciled.session, TOKEN_B, "foreign-claim-recovery"), ...proof,
    }), "CLAIM_CONFLICT");
    expect(db.prepare(
      "SELECT state FROM coordination_worktree_epochs WHERE project_id = ? AND worktree_id = ?",
    ).get(alpha.id, MAIN.worktreeId)).toEqual({ state: "quarantined" });
  });

  it("fails closed for an incomplete pre-075 database and preserves the full registry after migration", () => {
    tempDir = mkdtempSync(join(tmpdir(), "ingenium-coordination-pre075-"));
    const dbPath = join(tempDir, "pre075.db");
    process.env.INGENIUM_CORE_DB_PATH = dbPath;
    process.env.INGENIUM_HOME = join(tempDir, "home");
    resetDbForTest();
    createPreCoordinationDatabase(dbPath);
    const pre075 = new Database(dbPath);
    expect(pre075.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'coordination_%'",
    ).get()).toEqual({ count: 0 });
    pre075.close();
    const migrated = getDb(dbPath);
    expect(migrated.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(migrated.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'coordination_%'",
    ).get()).toEqual({ count: 10 });
  });
});

describe("COORD-101 migration partial fixtures", () => {
  it("retains the migration's transactional boundary and immutable update trigger", () => {
    const migration = readFileSync(
      resolve(import.meta.dirname ?? __dirname, "../data/migrations/075_coordination_registry.sql"),
      "utf8",
    );
    expect(migration.trimStart()).toMatch(/^--[\s\S]*BEGIN IMMEDIATE;/);
    expect(migration).toContain("COMMIT;");
    expect(migration).toContain("CREATE TRIGGER coordination_mutation_receipts_immutable_update");
    expect(migration).toContain("RAISE(ABORT, 'coordination mutation receipts are immutable — UPDATE rejected')");
  });
});
