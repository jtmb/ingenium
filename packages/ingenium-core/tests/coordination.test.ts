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
  claimCoordinationBatch,
  closeCoordinationSession,
  getCoordinationSession,
  getCoordinationStatus,
  heartbeatCoordinationSession,
  markCoordinationClaims,
  recoverCoordinationSession,
  registerCoordinationSession,
  releaseCoordinationClaims,
  updateCoordinationSnapshot,
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
    nextOwnershipToken,
    ttlMs: 2_000,
    idempotencyKey,
  };
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
      { name: "coordination_mutation_receipts" },
      { name: "coordination_sessions" },
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

  it("applies migration 075 when none of its components exist and reopens cleanly when all exist", () => {
    const { db } = setup();
    expect(db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'coordination_%'",
    ).get()).toEqual({ count: 4 });

    resetDbForTest();
    const reopened = getDb(process.env.INGENIUM_CORE_DB_PATH);
    expect(reopened.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'coordination_%'",
    ).get()).toEqual({ count: 4 });
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
      claims: [{ claim: { kind: "path", path: "same/path" } }],
    });
    expect(claimCoordinationBatch(beta.id, {
      ...lease(MAIN, betaMain, TOKEN_B, "beta-claim"),
      claims: [{ claim: { kind: "path", path: "same/path" } }],
    }).claimIds).toHaveLength(1);
    expect(claimCoordinationBatch(alpha.id, {
      ...lease(OTHER_WORKTREE, alphaOther, TOKEN_C, "other-worktree-claim"),
      claims: [{ claim: { kind: "path", path: "same/path" } }],
    }).claimIds).toHaveLength(1);
    expectCode(() => claimCoordinationBatch(alpha.id, {
      ...lease(SECOND_SESSION, alphaSecond, TOKEN_D, "same-worktree-collision"),
      claims: [{ claim: { kind: "path", path: "same/path" } }],
    }), "CLAIM_CONFLICT");
    expect(getCoordinationStatus(alpha.id, MAIN)?.claims[0]?.id).toBe(alphaClaim.claimIds[0]);
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

  it("replays an exact registration before identity checks and rejects a changed request hash", () => {
    const { alpha } = setup();
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
    expect(getCoordinationStatus(alpha.id, MAIN)?.claims[0]).toMatchObject({
      fence: taken.fence,
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
    expectCode(() => authorizedTakeoverCoordinationSession(alpha.id, takeoverInput(
      closeIdentity, closed, TOKEN_D, "takeover-closed",
    )), "SESSION_CLOSED");
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
    expect(JSON.stringify(getCoordinationStatus(alpha.id, MAIN))).not.toContain(tokenTask.id);

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
    expect(JSON.stringify(getCoordinationStatus(alpha.id, OTHER_WORKTREE))).not.toContain(tokenContext.id);

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
      claims: [{ claim: { kind: "path", path: "foo" }, baselineSha256: "a".repeat(64) }],
    });
    const foobar = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, foo.session, TOKEN_A, "claim-foobar"),
      claims: [{ claim: { kind: "path", path: "foobar" } }],
    });
    expect(foobar.claimIds).toHaveLength(1);
    expect(getCoordinationStatus(alpha.id, MAIN)?.claims.map((claim) => claim.value).sort())
      .toEqual(["foo", "foobar"]);
    expect(getCoordinationStatus(alpha.id, MAIN)?.claims.find((claim) => claim.value === "foo")?.baseline_sha256)
      .toBe("a".repeat(64));
    expectCode(() => claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, foobar.session, TOKEN_A, "claim-tree-collision"),
      claims: [{ claim: { kind: "tree", path: "foo" } }],
    }), "CLAIM_CONFLICT");
  });

  it("rejects self-overlap atomically and leaves no partial claims or receipt", () => {
    const { db, alpha } = setup();
    const session = register(alpha.id);
    expectCode(() => claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "self-overlap"),
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
      claims: [{ claim: { kind: "path", path: "one" }, baselineSha256: "b".repeat(64) }],
    });
    expect(claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "duplicate-claim"),
      claims: [{ claim: { kind: "path", path: "one" }, baselineSha256: "b".repeat(64) }],
    })).toEqual(first);
    expectCode(() => claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, first.session, TOKEN_A, "duplicate-claim-changed"),
      claims: [{ claim: { kind: "path", path: "one" }, baselineSha256: "c".repeat(64) }],
    }), "CLAIM_CONFLICT");

    const second = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, first.session, TOKEN_A, "claim-two"),
      claims: [
        { claim: { kind: "path", path: "two" } },
        { claim: { kind: "path", path: "three" } },
        { claim: { kind: "path", path: "four" } },
      ],
    });
    const [one, two, three, four] = [first.claimIds[0]!, ...second.claimIds];
    const dirty = markCoordinationClaims(alpha.id, {
      ...lease(MAIN, second.session, TOKEN_A, "mark-dirty"),
      claimIds: [one],
      state: "dirty",
    });
    const quarantined = markCoordinationClaims(alpha.id, {
      ...lease(MAIN, dirty.session, TOKEN_A, "mark-quarantined"),
      claimIds: [two],
      state: "quarantined",
    });
    const collision = markCoordinationClaims(alpha.id, {
      ...lease(MAIN, quarantined.session, TOKEN_A, "mark-collision"),
      claimIds: [three],
      state: "collision",
    });
    const released = releaseCoordinationClaims(alpha.id, {
      ...lease(MAIN, collision.session, TOKEN_A, "release-four"),
      claimIds: [four],
    });
    expect(released.session.revision).toBe(collision.session.revision + 1);
    expect(getCoordinationStatus(alpha.id, MAIN)?.claims.map((claim) => claim.state).sort())
      .toEqual(["collision", "dirty", "quarantined", "released"]);
    expect(db.prepare("SELECT count(*) AS count FROM coordination_mutation_receipts").get()).toEqual({ count: 7 });
  });

  it("closes by releasing active claims, retaining receipts and the fence allocator", () => {
    const { db, alpha } = setup();
    const session = register(alpha.id);
    const claimed = claimCoordinationBatch(alpha.id, {
      ...lease(MAIN, session, TOKEN_A, "close-claim"),
      claims: [{ claim: { kind: "path", path: "retained" } }],
    });
    const closed = closeCoordinationSession(alpha.id, lease(MAIN, claimed.session, TOKEN_A, "close-session"));
    expect(getCoordinationStatus(alpha.id, MAIN)?.session.state).toBe("closed");
    expect(getCoordinationStatus(alpha.id, MAIN)?.claims).toEqual([
      expect.objectContaining({ id: claimed.claimIds[0], state: "released" }),
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
    ).get()).toEqual({ count: 4 });
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
