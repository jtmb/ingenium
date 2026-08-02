import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import {
  TaskCoordinationError,
  addComment,
  bulkUpdateTasks,
  createTask,
  deleteTask,
  editComment,
  getComments,
  getTask,
  getTaskActivity,
  getTaskLinks,
  getTaskTree,
  linkTasks,
  markNotificationRead,
  moveTask,
  notifyTask,
  releaseTask,
  reserveTask,
  updateTask,
} from "../lib/tools/tasks.js";
import {
  canonicalTaskClaimBatch,
  parseTaskClaim,
  taskClaimsOverlap,
  taskCoordinationState,
  TASK_CLAIM_GUARANTEE,
  TASK_MANAGED_GUARANTEE_VOCABULARY,
} from "../lib/tools/task-claims.js";

let directory = "";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;

function setup() {
  directory = mkdtempSync(join(tmpdir(), "ingenium-task-coordination-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  process.env.INGENIUM_HOME = join(directory, "home");
  resetDbForTest();
  return {
    db: getDb(process.env.INGENIUM_CORE_DB_PATH),
    alpha: createProject("coordination-alpha"),
    beta: createProject("coordination-beta"),
  };
}

afterEach(() => {
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
});

function expectCode(run: () => unknown, code: string): void {
  expect(run).toThrow(expect.objectContaining({ code }));
}

describe("COORD-100 task coordination", () => {
  it("keeps old tasks available at revision zero and detects an earliest-column-only partial migration", () => {
    const { db, alpha } = setup();
    const task = createTask(alpha.id, "Existing-compatible task");
    expect(task).toMatchObject({ revision: 0, reservation_state: "available", reservation_owner: null, reservation_worktree: null });
    db.exec(`
      DROP TRIGGER tasks_reservation_consistency_insert;
      DROP TRIGGER tasks_reservation_consistency_update;
      DROP TRIGGER task_mutation_receipts_immutable_update;
      DROP TABLE task_mutation_receipts;
      ALTER TABLE tasks DROP COLUMN reservation_token_hash;
      ALTER TABLE tasks DROP COLUMN reservation_worktree;
      ALTER TABLE tasks DROP COLUMN reservation_owner;
      ALTER TABLE tasks DROP COLUMN reservation_state;
    `);
    resetDbForTest();
    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow(
      "Migration 073 is in a PARTIAL state. Missing required components: tasks coordination columns, tasks coordination constraints, task_mutation_receipts table, idx_task_mutation_receipts_project_task_created index, tasks_reservation_consistency_insert trigger, tasks_reservation_consistency_update trigger, task_mutation_receipts_immutable_update trigger. Restore the migration's complete schema before retrying.",
    );
  });

  it("fails closed on a later partial migration state", () => {
    const { db } = setup();
    db.prepare("DROP TRIGGER task_mutation_receipts_immutable_update").run();
    resetDbForTest();
    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow(
      "Migration 073 is in a PARTIAL state. Missing required components: task_mutation_receipts_immutable_update trigger. Restore the migration's complete schema before retrying.",
    );
  });

  it("scopes task members and child resources to their supplied project", () => {
    const { alpha, beta } = setup();
    const alphaTask = createTask(alpha.id, "alpha");
    const betaTask = createTask(beta.id, "beta");
    const comment = addComment(alpha.id, alphaTask.id, "author", "body");
    const notification = notifyTask(alpha.id, "owner", alphaTask.id, "assigned")!;

    expect(getTask(beta.id, alphaTask.id)).toBeUndefined();
    expect(getComments(beta.id, alphaTask.id)).toEqual([]);
    expect(getTaskActivity(beta.id, alphaTask.id)).toEqual([]);
    expect(getTaskLinks(beta.id, alphaTask.id)).toEqual([]);
    expect(getTaskTree(beta.id, alphaTask.id)).toEqual([]);
    expectCode(() => moveTask(beta.id, alphaTask.id, "review"), "TASK_NOT_FOUND");
    expectCode(() => updateTask(beta.id, alphaTask.id, { title: "foreign" }), "TASK_NOT_FOUND");
    expectCode(() => editComment(beta.id, alphaTask.id, comment.id, "foreign"), "TASK_NOT_FOUND");
    expectCode(() => linkTasks(alpha.id, alphaTask.id, betaTask.id, "blocks"), "TASK_NOT_FOUND");
    expectCode(() => notifyTask(beta.id, "owner", alphaTask.id, "assigned"), "TASK_NOT_FOUND");
    expectCode(() => markNotificationRead(beta.id, notification.id), "TASK_NOT_FOUND");
    expectCode(() => createTask(alpha.id, "foreign parent", undefined, undefined, { parent_id: betaTask.id }), "TASK_NOT_FOUND");
    expectCode(() => bulkUpdateTasks(alpha.id, [alphaTask.id, betaTask.id], { priority: 9 }), "TASK_NOT_FOUND");
    expect(getTask(alpha.id, alphaTask.id)?.priority).toBe(0);
  });

  it("enforces CAS and returns an exact idempotent receipt before revision checks", () => {
    const { db, alpha } = setup();
    const task = createTask(alpha.id, "CAS");
    const first = updateTask(alpha.id, task.id, { title: "updated" }, undefined, {
      expectedRevision: 0,
      idempotencyKey: "coord-update-1",
    })!;
    expect(first.revision).toBe(1);
    const replay = updateTask(alpha.id, task.id, { title: "updated" }, undefined, {
      expectedRevision: 0,
      idempotencyKey: "coord-update-1",
    })!;
    expect(replay).toEqual(first);
    expectCode(() => updateTask(alpha.id, task.id, { title: "different" }, undefined, {
      expectedRevision: 1,
      idempotencyKey: "coord-update-1",
    }), "IDEMPOTENCY_KEY_REUSED");
    try {
      updateTask(alpha.id, task.id, { priority: 1 }, undefined, { expectedRevision: 0 });
      throw new Error("expected conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(TaskCoordinationError);
      expect(error).toMatchObject({ code: "REVISION_CONFLICT", currentRevision: 1 });
    }
    expect(() => db.prepare("UPDATE task_mutation_receipts SET operation = 'tampered'").run()).toThrow(/immutable/);
  });

  it("reserves and releases atomically with exact ownership", () => {
    const { db, alpha } = setup();
    const task = createTask(alpha.id, "Reservation");
    const reservationToken = "0123456789abcdef0123456789abcdef";
    const reserve = { expectedRevision: 0, owner: "agent-a", worktree: "worktree-a", reservationToken, idempotencyKey: "reserve-1" };
    const reserved = reserveTask(alpha.id, task.id, reserve);
    expect(reserved).toMatchObject({ revision: 1, reservation_state: "reserved", reservation_owner: "agent-a", reservation_worktree: "worktree-a" });
    expect(JSON.stringify(reserved)).not.toContain("reservation_token_hash");
    expect(db.prepare("SELECT reservation_token_hash FROM tasks WHERE id = ?").get(task.id)).toEqual({
      reservation_token_hash: "3eb1bd439947eb762998e566ccc2e099c791118b2f40579cc4f7da2b5061b7f9",
    });
    expect(reserveTask(alpha.id, task.id, reserve)).toEqual(reserved);
    expectCode(() => releaseTask(alpha.id, task.id, { ...reserve, expectedRevision: 1, reservationToken: "fedcba9876543210fedcba9876543210", idempotencyKey: "release-1" }), "RESERVATION_OWNER_MISMATCH");
    expect(releaseTask(alpha.id, task.id, { ...reserve, expectedRevision: 1, idempotencyKey: "release-2" }))
      .toMatchObject({ revision: 2, reservation_state: "available", reservation_owner: null, reservation_worktree: null });
  });

  it("requires a complete managed bulk revision map and rolls stale or foreign inputs back wholly", () => {
    const { alpha, beta } = setup();
    const first = createTask(alpha.id, "first");
    const second = createTask(alpha.id, "second");
    const foreign = createTask(beta.id, "foreign");
    expectCode(() => bulkUpdateTasks(alpha.id, [first.id, second.id], { priority: 3 }, {
      expectedRevisions: { [first.id]: 0 },
    }), "INVALID_TASK_MUTATION_INPUT");
    expectCode(() => bulkUpdateTasks(alpha.id, [first.id, foreign.id], { priority: 3 }, {
      expectedRevisions: { [first.id]: 0, [foreign.id]: 0 },
    }), "TASK_NOT_FOUND");
    expect(getTask(alpha.id, first.id)?.revision).toBe(0);
    expect(getTask(alpha.id, first.id)?.priority).toBe(0);
    expect(bulkUpdateTasks(alpha.id, [first.id, second.id], { priority: 3 }, {
      expectedRevisions: { [first.id]: 0, [second.id]: 0 },
      idempotencyKey: "bulk-1",
    })).toBe(2);
    expect(getTask(alpha.id, first.id)).toMatchObject({ priority: 3, revision: 1 });
    expectCode(() => bulkUpdateTasks(alpha.id, [first.id, second.id], { priority: 4 }, {
      expectedRevisions: { [first.id]: 0, [second.id]: 0 },
    }), "REVISION_CONFLICT");
  });

  it("uses scalar bulk revisions unless a per-task map overrides them and hashes both", () => {
    const { alpha } = setup();
    const first = createTask(alpha.id, "first");
    const second = createTask(alpha.id, "second");
    updateTask(alpha.id, second.id, { priority: 1 });
    expect(bulkUpdateTasks(alpha.id, [first.id, second.id], { title: undefined, priority: 2 }, {
      expectedRevision: 0,
      expectedRevisions: { [second.id]: 1 },
      idempotencyKey: "bulk-scalar-map-1",
    })).toBe(2);
    expect(getTask(alpha.id, first.id)).toMatchObject({ priority: 2, revision: 1 });
    expect(getTask(alpha.id, second.id)).toMatchObject({ priority: 2, revision: 2 });
    expectCode(() => bulkUpdateTasks(alpha.id, [first.id, second.id], { priority: 3 }, {
      expectedRevision: 0,
      expectedRevisions: { [second.id]: 1 },
    }), "REVISION_CONFLICT");
    expectCode(() => bulkUpdateTasks(alpha.id, [first.id, second.id], { priority: 2 }, {
      expectedRevision: 1,
      expectedRevisions: { [second.id]: 1 },
      idempotencyKey: "bulk-scalar-map-1",
    }), "IDEMPOTENCY_KEY_REUSED");
  });

  it("preserves explicit null while omitting undefined updates", () => {
    const { alpha } = setup();
    const task = createTask(alpha.id, "defined fields", "description");
    const updated = updateTask(alpha.id, task.id, { title: undefined, description: null });
    expect(updated).toMatchObject({ title: "defined fields", description: null });
    expect(bulkUpdateTasks(alpha.id, [task.id], { title: undefined, description: null })).toBe(1);
    expect(getTask(alpha.id, task.id)).toMatchObject({ title: "defined fields", description: null });
  });

  it("allows receipt cascading only through a parent project delete while retaining update immutability", () => {
    const { db, alpha } = setup();
    const task = createTask(alpha.id, "receipt", undefined, undefined, undefined, { idempotencyKey: "project-cascade-1" });
    expect(() => db.prepare("UPDATE task_mutation_receipts SET operation = 'tampered'").run()).toThrow(/immutable/);
    expect(deleteTask(alpha.id, task.id, undefined, { idempotencyKey: "project-cascade-delete-1" })).toBe(true);
    expect(db.prepare("DELETE FROM projects WHERE id = ?").run(alpha.id).changes).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM task_mutation_receipts WHERE project_id = ?").get(alpha.id)).toEqual({ count: 0 });
  });

  it("uses the exact discriminated claim grammar and segment-aware overlap matrix", () => {
    expect(parseTaskClaim({ kind: "path", path: ".opencode/skills" })).toEqual({ kind: "path", path: ".opencode/skills" });
    expect(parseTaskClaim({ kind: "tree", path: ".github/workflows" })).toEqual({ kind: "tree", path: ".github/workflows" });
    expect(parseTaskClaim({ kind: "reserved", name: "@build" })).toEqual({ kind: "reserved", name: "@build" });
    for (const invalid of [
      { kind: "path", path: "" }, { kind: "path", path: "/absolute" }, { kind: "path", path: "a\\b" },
      { kind: "path", path: "a/*" }, { kind: "path", path: "a/" }, { kind: "path", path: "./a" },
      { kind: "path", path: "a/../b" }, { kind: "path", path: ".git/config" }, { kind: "path", path: ".env" },
       { kind: "path", path: "secrets/key" }, { kind: "path", path: ".ssh/id_ed25519" },
       { kind: "path", path: ".gnupg/private-keys-v1.d" }, { kind: "path", path: ".aws/credentials" },
       { kind: "path", path: ".npmrc" }, { kind: "path", path: ".pypirc" }, { kind: "path", path: ".netrc" },
       { kind: "path", path: ".git-credentials" }, { kind: "path", path: "config/credentials.json" },
       { kind: "path", path: "keys/id_ed25519" }, { kind: "path", path: "keys/id_rsa" },
       { kind: "path", path: "keys/id_ecdsa" }, { kind: "path", path: "keys/id_dsa" },
       { kind: "path", path: "keys/server.key" }, { kind: "path", path: "keys/private.pem" },
       { kind: "path", path: "keys/server-private.pem" }, { kind: "path", path: "keys/server.pem" },
       { kind: "path", path: "@build/output" },
       { kind: "reserved", name: "@build/output" }, { kind: "reserved", name: "@repository/config" },
     ]) expect(parseTaskClaim(invalid)).toBeUndefined();
    expect(canonicalTaskClaimBatch([
      { kind: "path", path: ".opencode/skills" },
      { kind: "reserved", name: "@repository" },
    ])).toEqual([
      { kind: "path", path: ".opencode/skills" },
      { kind: "reserved", name: "@repository" },
    ]);
    expect(taskClaimsOverlap({ kind: "path", path: "foo" }, { kind: "path", path: "foobar" })).toBe(false);
    expect(taskClaimsOverlap({ kind: "path", path: "foo/bar" }, { kind: "tree", path: "foo" })).toBe(true);
    expect(taskClaimsOverlap({ kind: "path", path: "foo" }, { kind: "tree", path: "foo/bar" })).toBe(false);
    expect(taskClaimsOverlap({ kind: "tree", path: "foo" }, { kind: "tree", path: "foobar" })).toBe(false);
    expect(taskClaimsOverlap({ kind: "reserved", name: "@repository" }, { kind: "path", path: "foo" })).toBe(true);
    expect(taskClaimsOverlap({ kind: "reserved", name: "@build" }, { kind: "tree", path: "foo" })).toBe(false);
    expect(taskClaimsOverlap({ kind: "reserved", name: "@build" }, { kind: "reserved", name: "@build" })).toBe(true);
    expect(taskCoordinationState(true, "quarantined")).toBe("managed-quarantined");
    expect(TASK_MANAGED_GUARANTEE_VOCABULARY["managed-clean"]).toContain("manual or external write guarantee");
    expect(TASK_CLAIM_GUARANTEE).toMatchObject({
      managedAgents: true,
      sameProject: true,
      canonicalWorktree: true,
      acceptedSessionEpoch: true,
      runtimeEnforcement: false,
      supportedClaims: ["path", "tree", "reserved"],
      exclusions: ["manual editor", "external process", "transcripts", "historical audit"],
    });
    expect(Object.isFrozen(TASK_CLAIM_GUARANTEE)).toBe(true);
  });
});
