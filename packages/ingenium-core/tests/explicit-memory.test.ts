import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { logger } from "../lib/logger.js";
import {
  context,
  explicitMemory,
  getDb,
  identity,
  mcpCredentials,
  organizations,
  projects,
  resetDbForTest,
  runtimes,
} from "../lib/index.js";

let directory = "";
let project: ReturnType<typeof projects.createProject>;
let owner: ReturnType<typeof identity.createUser>;
let scope: explicitMemory.ExplicitMemoryScope;

beforeEach(() => {
  resetDbForTest();
  directory = mkdtempSync(join(tmpdir(), "ingenium-explicit-memory-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  process.env.INGENIUM_HOME = directory;
  initializeScope();
});

function initializeScope() {
  project = projects.createProject("memory-foundation");
  owner = identity.createUser("memory-owner@example.test", "Memory Owner");
  organizations.addOrganizationMember(project.organization_id, owner.id, "admin");
  runtimes.authorizeWorkspace({
    id: "memory-workspace",
    organizationId: project.organization_id,
    projectId: project.id,
    ownerUserId: owner.id,
    storagePath: join(directory, "workspace"),
  });
  scope = explicitMemory.resolveExplicitMemoryScope({
    projectId: project.id,
    workspaceId: "memory-workspace",
    principal: { type: "user", userId: owner.id },
  });
}

afterEach(() => {
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  delete process.env.INGENIUM_HOME;
  rmSync(directory, { recursive: true, force: true });
});

describe("explicit saved memory core", () => {
  it("startup applies migration 115 to a fresh database and does not reapply on reopen", () => {
    resetDbForTest();
    const path = join(directory, "fresh-migrations.db");
    const log = vi.spyOn(logger, "info");
    try {
      const db = getDb(path);
      expect(log).toHaveBeenCalledWith("db", "Applied migration 115_explicit_memory_fts_update_order.sql");
      expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'explicit_memories_fts_update_delete'").get())
        .toMatchObject({ sql: expect.stringContaining("BEFORE UPDATE ON explicit_memories") });
      expect(db.pragma("foreign_key_check")).toEqual([]);
      resetDbForTest();
      log.mockClear();
      getDb(path);
      expect(log).not.toHaveBeenCalledWith("db", "Applied migration 115_explicit_memory_fts_update_order.sql");
    } finally {
      log.mockRestore();
    }
  });

  it.each(["old AFTER", "fresh BEFORE"])("migration 115 repairs %s migration 114 without changing memory records", (ordering) => {
    resetDbForTest();
    process.env.INGENIUM_CORE_DB_PATH = join(directory, "migration.db");
    const migrationDirectory = new URL("../data/migrations/", import.meta.url);
    const fixture = new Database(process.env.INGENIUM_CORE_DB_PATH);
    fixture.function("sha256", { deterministic: true }, (value: string) => createHash("sha256").update(value).digest("hex"));
    fixture.pragma("foreign_keys = ON");
    try {
      for (const file of readdirSync(migrationDirectory).filter((file) => file.endsWith(".sql")
        && !file.includes("upgrade") && Number(file.slice(0, 3)) <= 114).sort()) {
        let sql = readFileSync(new URL(file, migrationDirectory), "utf8");
        if (ordering === "old AFTER" && file === "114_explicit_saved_memory.sql") {
          sql = sql.replace("explicit_memories_fts_update_delete\nBEFORE UPDATE", "explicit_memories_fts_update_delete\nAFTER UPDATE");
        }
        fixture.exec(sql);
      }
      if (ordering === "fresh BEFORE") {
        fixture.exec(readFileSync(new URL("115_explicit_memory_fts_update_order.sql", migrationDirectory), "utf8"));
      }
    } finally {
      fixture.close();
    }
    initializeScope();
    let db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const trigger = () => (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'explicit_memories_fts_update_delete'").get() as { sql: string }).sql;
    expect(trigger()).toContain("BEFORE UPDATE");
    if (ordering === "old AFTER") {
      const insertTrigger = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'explicit_memories_fts_update_insert'").get() as { sql: string }).sql;
      db.exec(`DROP TRIGGER explicit_memories_fts_update_delete;
        DROP TRIGGER explicit_memories_fts_update_insert;
        ${trigger().replace("BEFORE UPDATE", "AFTER UPDATE")}; ${insertTrigger}`);
    }
    expect(trigger()).toContain(ordering === "old AFTER" ? "AFTER UPDATE" : "BEFORE UPDATE");
    const saved = explicitMemory.saveExplicitMemory(scope, {
      operationId: "migration-save", content: "The violet lighthouse uses channel seven.", tags: ["radio"],
    }).memory!;
    explicitMemory.updateExplicitMemory(scope, saved.id, {
      operationId: "migration-update", expectedVersion: 1,
      content: "The violet lighthouse now uses channel nine.", tags: ["radio", "updated"],
    });
    expect(explicitMemory.searchExplicitMemories(scope, "channel nine").items)
      .toHaveLength(ordering === "old AFTER" ? 0 : 1);

    const records = () => ["explicit_memories", "explicit_memory_operation_receipts", "explicit_memory_versions",
      "explicit_memory_tombstones", "explicit_memory_restore_suppressions"].map((table) => db.prepare(`SELECT * FROM ${table}`).all());
    const schema = () => db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'explicit_memories_fts%' ORDER BY type, name").all();
    const beforeRecords = records();
    const beforeSchema = schema();
    const repair = readFileSync(new URL("115_explicit_memory_fts_update_order.sql", migrationDirectory), "utf8");
    resetDbForTest();
    db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    expect(trigger()).toContain("BEFORE UPDATE");
    expect(records()).toEqual(beforeRecords);
    expect(explicitMemory.searchExplicitMemories(scope, "channel nine").items).toMatchObject([{ memory: { id: saved.id, version: 2 } }]);
    db.exec(repair);
    expect(trigger()).toContain("BEFORE UPDATE");
    expect(records()).toEqual(beforeRecords);
    expect(schema()).toEqual(beforeSchema);
    expect(explicitMemory.searchExplicitMemories(scope, "channel nine").items).toMatchObject([{ memory: { id: saved.id, version: 2 } }]);
    expect(explicitMemory.searchExplicitMemories(scope, "channel seven").items).toEqual([]);
    explicitMemory.updateExplicitMemory(scope, saved.id, {
      operationId: "migration-update-again", expectedVersion: 2,
      content: "The violet lighthouse uses channel ten.", tags: ["radio"],
    });
    expect(explicitMemory.searchExplicitMemories(scope, "channel ten").items).toHaveLength(1);
    expect(explicitMemory.searchExplicitMemories(scope, "radio").items).toHaveLength(1);
    expect(explicitMemory.searchExplicitMemories(scope, "nine").items).toEqual([]);
    explicitMemory.forgetExplicitMemory(scope, saved.id, { operationId: "migration-forget", expectedVersion: 3 });
    db.exec(repair);
    expect(explicitMemory.searchExplicitMemories(scope, "channel ten").items).toEqual([]);
    expect(explicitMemory.readExplicitMemory(scope, saved.id)).toBeUndefined();
    expect(explicitMemory.resolveExplicitMemoryState(scope, saved.id)).toMatchObject({ state: "forgotten", tombstone: { version: 4 } });
    db.exec("DROP TRIGGER explicit_memories_fts_update_delete");
    db.exec(repair);
    expect(trigger()).toContain("BEFORE UPDATE");
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("persists exact user-directed preferences across database connections and isolates projects", () => {
    const content = "  I prefer concise answers.\nKeep code examples in TypeScript.  ";
    const saved = explicitMemory.saveExplicitMemory(scope, { operationId: "preference-save", content }).memory!;
    expect(saved).toMatchObject({ content, tags: ["preference"], source: "user-directive", projectId: project.id });
    expect(saved.createdAt).toBe(saved.updatedAt);
    expect(Number.isNaN(Date.parse(saved.createdAt))).toBe(false);
    resetDbForTest();
    expect(explicitMemory.readExplicitMemory(scope, saved.id)?.memory).toEqual(saved);
    expect(explicitMemory.listExplicitMemories(scope).items.map((item) => item.memory)).toEqual([saved]);
    expect(explicitMemory.searchExplicitMemories(scope, "preference").items[0]?.memory).toEqual(saved);
    expect(explicitMemory.searchExplicitMemories(scope, "TypeScript").items[0]?.memory.content).toBe(content);

    const otherProject = projects.createProject("other-memory-project");
    runtimes.authorizeWorkspace({
      id: "other-project-workspace", organizationId: otherProject.organization_id,
      projectId: otherProject.id, ownerUserId: owner.id, storagePath: join(directory, "other-workspace"),
    });
    const otherScope = explicitMemory.resolveExplicitMemoryScope({
      projectId: otherProject.id, workspaceId: "other-project-workspace", principal: { type: "user", userId: owner.id },
    });
    expect(explicitMemory.readExplicitMemory(otherScope, saved.id)).toBeUndefined();
    expect(explicitMemory.listExplicitMemories(otherScope).items).toEqual([]);
    expect(explicitMemory.searchExplicitMemories(otherScope, "TypeScript").items).toEqual([]);
    expect(() => explicitMemory.updateExplicitMemory(otherScope, saved.id, {
      operationId: "foreign-update", expectedVersion: 1, content: "Not authorized",
    })).toThrow(expect.objectContaining({ code: "MEMORY_NOT_FOUND" }));
    expect(() => explicitMemory.forgetExplicitMemory(otherScope, saved.id, {
      operationId: "foreign-delete", expectedVersion: 1,
    })).toThrow(expect.objectContaining({ code: "MEMORY_NOT_FOUND" }));

    const updatedContent = "\nI prefer detailed answers.  ";
    const updated = explicitMemory.updateExplicitMemory(scope, saved.id, {
      operationId: "preference-update", expectedVersion: 1, content: updatedContent,
    }).memory!;
    expect(updated).toMatchObject({ content: updatedContent, tags: ["preference"], source: "user-directive", createdAt: saved.createdAt });
    expect(updated.updatedAt >= saved.updatedAt).toBe(true);
    expect(explicitMemory.searchExplicitMemories(scope, "concise").items).toEqual([]);
    expect(explicitMemory.searchExplicitMemories(scope, "detailed").items[0]?.memory.content).toBe(updatedContent);
    explicitMemory.forgetExplicitMemory(scope, saved.id, { operationId: "preference-forget", expectedVersion: 2 });
    resetDbForTest();
    expect(explicitMemory.listExplicitMemories(scope).items).toEqual([]);
    expect(explicitMemory.readExplicitMemory(scope, saved.id)).toBeUndefined();
    expect(explicitMemory.searchExplicitMemories(scope, "detailed").items).toEqual([]);
  });

  it("keeps restored active content suppressed after the FTS repair rebuild", async () => {
    const saved = explicitMemory.saveExplicitMemory(scope, {
      operationId: "restore-save", content: "The restored lighthouse uses channel nine.",
    }).memory!;
    const snapshotPath = join(directory, "snapshot.db");
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    await db.backup(snapshotPath);
    const forgotten = explicitMemory.forgetExplicitMemory(scope, saved.id, { operationId: "restore-forget", expectedVersion: 1 });
    const receipt = db.prepare("SELECT request_hash, result_json FROM explicit_memory_operation_receipts WHERE id = ?")
      .get(forgotten.receipt.receiptId) as { request_hash: string; result_json: string };
    const tombstone = explicitMemory.listExplicitMemoryTombstones(scope)[0]!;
    const entry = JSON.stringify(tombstone);
    resetDbForTest();
    process.env.INGENIUM_CORE_DB_PATH = snapshotPath;
    const restored = getDb(snapshotPath);
    restored.prepare(`INSERT INTO explicit_memory_restore_suppressions
      (memory_id, organization_id, project_id, workspace_id, owner_user_id, visibility,
       version, prior_content_hash, receipt_id, operation_id, request_hash, result_json,
       entry_json, entry_hash, forgotten_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(saved.id, scope.organizationId, scope.projectId, scope.workspaceId, scope.ownerUserId,
        saved.visibility, tombstone.version, tombstone.priorContentHash, tombstone.receiptId,
        forgotten.receipt.operationId, receipt.request_hash, receipt.result_json,
        entry, createHash("sha256").update(entry).digest("hex"), tombstone.forgottenAt);
    restored.exec(readFileSync(new URL("../data/migrations/115_explicit_memory_fts_update_order.sql", import.meta.url), "utf8"));
    expect(restored.prepare("SELECT state FROM explicit_memories WHERE id = ?").get(saved.id)).toEqual({ state: "active" });
    expect(explicitMemory.readExplicitMemory(scope, saved.id)).toBeUndefined();
    expect(explicitMemory.listExplicitMemories(scope).items).toEqual([]);
    expect(explicitMemory.searchExplicitMemories(scope, "channel nine").items).toEqual([]);
    expect(explicitMemory.resolveExplicitMemoryState(scope, saved.id)).toEqual({ state: "forgotten", tombstone });
    expect(explicitMemory.getExplicitMemoryOperationStatus(scope, "restore-forget"))
      .toEqual({ status: "committed", receipt: forgotten.receipt });
    expect(() => explicitMemory.updateExplicitMemory(scope, saved.id, {
      operationId: "restore-update", expectedVersion: 1, content: "Must not resurrect.",
    })).toThrow(expect.objectContaining({ code: "MEMORY_NOT_FOUND" }));
    expect(restored.pragma("foreign_key_check")).toEqual([]);
  });

  it("rejects secret-shaped content and tags before writing any plaintext or receipt", () => {
    const saved = explicitMemory.saveExplicitMemory(scope, { operationId: "safe-save", content: "Prefer short examples." }).memory!;
    const secrets = ["-----BEGIN PRIVATE KEY-----", `sk-${"a".repeat(24)}`, `ghp_${"b".repeat(36)}`, `password=${"c".repeat(24)}`];
    for (const [index, secret] of secrets.entries()) {
      for (const input of [{ content: secret }, { content: "Safe content", tags: [secret] }]) {
        expect(() => explicitMemory.saveExplicitMemory(scope, { operationId: `secret-save-${index}`, ...input }))
          .toThrow(expect.objectContaining({ code: "INVALID_MEMORY_INPUT" }));
        expect(() => explicitMemory.updateExplicitMemory(scope, saved.id, { operationId: `secret-update-${index}`, expectedVersion: 1, ...input }))
          .toThrow(expect.objectContaining({ code: "INVALID_MEMORY_INPUT" }));
      }
      expect(explicitMemory.getExplicitMemoryOperationStatus(scope, `secret-save-${index}`).status).toBe("unknown");
      expect(explicitMemory.getExplicitMemoryOperationStatus(scope, `secret-update-${index}`).status).toBe("unknown");
    }
    expect(explicitMemory.listExplicitMemories(scope).items.map((item) => item.memory)).toEqual([saved]);
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT count(*) AS count FROM explicit_memory_versions").get()).toEqual({ count: 1 });
  });

  it("checks the workspace parent before inserting a saved memory", () => {
    expect(() => explicitMemory.saveExplicitMemory({ ...scope, workspaceId: "missing-workspace" }, {
      operationId: "missing-parent", content: "Prefer short examples.",
    })).toThrow(expect.objectContaining({ code: "MEMORY_SCOPE_NOT_FOUND" }));
    expect(() => explicitMemory.saveExplicitMemory(scope, {
      operationId: "invalid-tags", content: "Prefer short examples.", tags: null as unknown as string[],
    })).toThrow(expect.objectContaining({ code: "INVALID_MEMORY_INPUT" }));
  });

  it("uses committed receipts, version CAS, FTS, and irreversible read suppression", () => {
    const memoryId = "11111111-1111-4111-8111-111111111111";
    const saved = explicitMemory.saveExplicitMemory(scope, {
      operationId: "save-one",
      memoryId,
      content: "The violet lighthouse uses channel seven.",
      tags: ["radio", "radio"],
    });
    expect(saved).toMatchObject({
      idempotent: false,
      memory: { id: memoryId, version: 1, visibility: "private", originType: "explicit" },
      receipt: { operationId: "save-one", operation: "save", status: "committed", version: 1 },
    });
    expect(explicitMemory.resolveExplicitMemoryState(scope, memoryId))
      .toMatchObject({ state: "active", memory: { id: memoryId, content: "The violet lighthouse uses channel seven." } });

    const replay = explicitMemory.saveExplicitMemory(scope, {
      operationId: "save-one",
      memoryId,
      content: "The violet lighthouse uses channel seven.",
      tags: ["radio", "radio"],
    });
    expect(replay).toMatchObject({ idempotent: true, receipt: { receiptId: saved.receipt.receiptId } });
    expect(() => explicitMemory.saveExplicitMemory(scope, {
      operationId: "save-one",
      memoryId,
      content: "A changed payload must not overwrite the memory.",
    })).toThrow(expect.objectContaining({ code: "OPERATION_CONFLICT" }));
    expect(() => explicitMemory.saveExplicitMemory(scope, {
      operationId: "save-two",
      memoryId,
      content: "A second operation cannot reuse the memory identifier.",
    })).toThrow(expect.objectContaining({ code: "MEMORY_CONFLICT" }));

    expect(explicitMemory.searchExplicitMemories(scope, "violet lighthouse").items)
      .toMatchObject([{ memory: { id: memoryId }, instructionAuthority: false, contentKind: "untrusted_memory_data" }]);
    const updated = explicitMemory.updateExplicitMemory(scope, memoryId, {
      operationId: "update-one",
      expectedVersion: 1,
      content: "The violet lighthouse now uses channel nine.",
      tags: ["updated"],
    });
    expect(updated).toMatchObject({ memory: { version: 2 }, receipt: { version: 2 } });
    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "UPDATE explicit_memories SET tags = '[1]', version = version + 1 WHERE id = ?",
    ).run(memoryId)).toThrow(/tags are invalid/);
    expect(explicitMemory.searchExplicitMemories(scope, "channel seven").items).toEqual([]);
    expect(explicitMemory.searchExplicitMemories(scope, "channel nine").items)
      .toMatchObject([{ memory: { id: memoryId, version: 2 } }]);
    expect(() => explicitMemory.updateExplicitMemory(scope, memoryId, {
      operationId: "stale-update",
      expectedVersion: 1,
      content: "Stale writes lose.",
    })).toThrow(expect.objectContaining({ code: "VERSION_CONFLICT", currentVersion: 2 }));

    const forgotten = explicitMemory.forgetExplicitMemory(scope, memoryId, {
      operationId: "forget-one",
      expectedVersion: 2,
    });
    expect(forgotten).toMatchObject({ memory: null, receipt: { operation: "forget", version: 3 } });
    expect(explicitMemory.forgetExplicitMemory(scope, memoryId, {
      operationId: "forget-one",
      expectedVersion: 2,
    })).toMatchObject({ idempotent: true, receipt: { receiptId: forgotten.receipt.receiptId } });
    expect(explicitMemory.readExplicitMemory(scope, memoryId)).toBeUndefined();
    expect(explicitMemory.listExplicitMemories(scope).items).toEqual([]);
    expect(explicitMemory.searchExplicitMemories(scope, "channel nine").items).toEqual([]);
    expect(explicitMemory.isExplicitMemorySuppressed(scope, memoryId)).toBe(true);
    const resolved = explicitMemory.resolveExplicitMemoryState(scope, memoryId);
    expect(resolved).toMatchObject({
      state: "forgotten",
      tombstone: { memoryId, version: 3, receiptId: forgotten.receipt.receiptId },
    });
    expect(JSON.stringify(resolved)).not.toContain("channel nine");
    expect(explicitMemory.listExplicitMemoryTombstones(scope)).toMatchObject([{
      memoryId,
      version: 3,
      receiptId: forgotten.receipt.receiptId,
    }]);
    expect(explicitMemory.getExplicitMemoryOperationStatus(scope, "forget-one"))
      .toMatchObject({ status: "committed", receipt: { receiptId: forgotten.receipt.receiptId } });
    expect(explicitMemory.getExplicitMemoryOperationStatus(scope, "unknown-operation"))
      .toEqual({ status: "unknown", operationId: "unknown-operation" });

    const persisted = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT state, content, tags FROM explicit_memories WHERE id = ?",
    ).get(memoryId);
    expect(persisted).toEqual({ state: "forgotten", content: "", tags: "[]" });
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT operation, version FROM explicit_memory_versions WHERE memory_id = ? ORDER BY version",
    ).all(memoryId)).toEqual([
      { operation: "save", version: 1 },
      { operation: "update", version: 2 },
      { operation: "forget", version: 3 },
    ]);
    expect((getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "PRAGMA table_info('explicit_memory_versions')",
    ).all() as Array<{ name: string }>).map(({ name }) => name)).not.toEqual(expect.arrayContaining(["content", "tags"]));
  });

  it("does not expose a committed receipt when a later write in the transaction fails", () => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    db.exec(`CREATE TRIGGER fail_memory_version_fixture
      BEFORE INSERT ON explicit_memory_versions
      BEGIN SELECT RAISE(ABORT, 'injected version failure'); END`);

    expect(() => explicitMemory.saveExplicitMemory(scope, {
      operationId: "failed-save",
      content: "This synthetic value must roll back with its receipt.",
    })).toThrow(/injected version failure/);
    expect(explicitMemory.getExplicitMemoryOperationStatus(scope, "failed-save"))
      .toEqual({ status: "unknown", operationId: "failed-save" });
    expect(db.prepare(
      "SELECT count(*) AS count FROM explicit_memories WHERE owner_user_id = ?",
    ).get(scope.ownerUserId)).toEqual({ count: 0 });
    expect(db.prepare(
      "SELECT count(*) AS count FROM explicit_memory_operation_receipts WHERE owner_user_id = ?",
    ).get(scope.ownerUserId)).toEqual({ count: 0 });
  });

  it("allows one of six same-version updates and bounds retrieval to 16 items and 2048 estimated tokens", () => {
    const memory = explicitMemory.saveExplicitMemory(scope, {
      operationId: "concurrent-save",
      content: "Initial concurrency value.",
    }).memory!;
    const outcomes = Array.from({ length: 6 }, (_, index) => {
      try {
        return explicitMemory.updateExplicitMemory(scope, memory.id, {
          operationId: `concurrent-update-${index}`,
          expectedVersion: 1,
          content: `Concurrent candidate ${index}.`,
        }).receipt.status;
      } catch (error) {
        return (error as explicitMemory.ExplicitMemoryError).code;
      }
    });
    expect(outcomes.filter((outcome) => outcome === "committed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "VERSION_CONFLICT")).toHaveLength(5);

    for (let index = 0; index < 17; index++) {
      explicitMemory.saveExplicitMemory(scope, {
        operationId: `budget-save-${index}`,
        content: `Bounded retrieval fact ${index}.`,
      });
    }
    const page = explicitMemory.listExplicitMemories(scope);
    expect(page.items).toHaveLength(16);
    expect(page.budget).toMatchObject({ maxItems: 16, maxTokens: 2_048, usedItems: 16, truncated: true });
    expect(page.budget.usedTokens).toBeLessThanOrEqual(2_048);
    expect(page.nextOffset).toBe(16);
    const smaller = explicitMemory.listExplicitMemories(scope, "private", { maxItems: 16, maxTokens: 8 });
    expect(smaller.budget.usedTokens).toBeLessThanOrEqual(8);
    expect(smaller.budget.truncated).toBe(true);
  });

  it("derives private-user delegation from an active workspace-bound service credential", () => {
    const credential = mcpCredentials.createMcpCredential({
      kind: "service",
      audience: "mcp",
      name: "memory delegation",
      scopes: ["memory:read", "memory:write", "projects:read"],
      organizationId: project.organization_id,
      projectId: project.id,
      workspaceId: scope.workspaceId,
      launcherWorktree: join(directory, "workspace"),
      expiresAt: new Date(Date.now() + 60_000),
      createdByUserId: owner.id,
    });
    const delegated = explicitMemory.resolveExplicitMemoryScope({
      projectId: project.id,
      workspaceId: scope.workspaceId,
      principal: {
        type: "service",
        servicePrincipalId: credential.servicePrincipalId,
        credentialId: credential.id,
        storageMappingHash: credential.storageMappingHash,
      },
    });
    expect(delegated).toMatchObject({ ownerUserId: owner.id, workspaceId: scope.workspaceId });
    const memory = explicitMemory.saveExplicitMemory(scope, {
      operationId: "delegated-update-save",
      content: "Tags survive an update that omits tags.",
      tags: ["preserved"],
    }).memory!;
    expect(explicitMemory.updateExplicitMemory(delegated, memory.id, {
      operationId: "delegated-update",
      expectedVersion: 1,
      content: "Updated through the delegated scope.",
    }).memory?.tags).toEqual(["preserved"]);
    expect(() => explicitMemory.resolveExplicitMemoryScope({
      projectId: project.id,
      workspaceId: scope.workspaceId,
      principal: {
        type: "service",
        servicePrincipalId: credential.servicePrincipalId,
        credentialId: credential.id,
        storageMappingHash: "f".repeat(64),
      },
    })).toThrow(expect.objectContaining({ code: "MEMORY_SCOPE_NOT_FOUND" }));
  });

  it("applies migration 114 over populated Context data without changing the fixture", () => {
    const entry = context.createContext(project.id, {
      content: "Existing populated Context fixture",
      tags: ["preserve"],
    });
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    db.exec(`
      DROP TABLE explicit_memory_versions;
      DROP TABLE explicit_memory_tombstones;
      DROP TABLE explicit_memory_restore_suppressions;
      DROP TABLE explicit_memory_operation_receipts;
      DROP TABLE explicit_memories_fts;
      DROP TABLE explicit_memories;
    `);
    resetDbForTest();

    const migrated = getDb(process.env.INGENIUM_CORE_DB_PATH);
    expect(migrated.prepare("SELECT content, tags FROM context_entries WHERE id = ?").get(entry.id))
      .toEqual({ content: "Existing populated Context fixture", tags: JSON.stringify(["preserve"]) });
    expect(migrated.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('explicit_memories', 'explicit_memory_operation_receipts', 'explicit_memory_versions', 'explicit_memory_tombstones', 'explicit_memory_restore_suppressions', 'explicit_memories_fts')",
    ).get()).toEqual({ count: 6 });
    expect(migrated.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
