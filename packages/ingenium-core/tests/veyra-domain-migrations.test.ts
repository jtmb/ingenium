import { mkdtempSync, realpathSync, rmSync, lstatSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTest, checkpointAfterWrite } from "../lib/db.js";
import { identity, organizations, projects } from "../lib/index.js";
import { MemoryLifecycle } from "../../../services/ingenium-api/lib/memory-v2/lifecycle.mjs";
import { ProjectCatalog } from "../../../services/ingenium-api/lib/projects-v2/catalog.mjs";
import { legacyDigest } from "../../../services/ingenium-api/lib/projects-v2/migration.mjs";
import { DotRepository } from "../../../services/ingenium-api/lib/dot-v2/repository.js";

let directory = "";
let fixtureParent = "";
beforeEach(() => {
  resetDbForTest();
  fixtureParent = realpathSync(tmpdir());
  directory = mkdtempSync(join(fixtureParent, "veyra-domain-integration-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data");
  process.env.INGENIUM_HOME = directory;
});
afterEach(() => {
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  delete process.env.INGENIUM_HOME;
  // This fixture creates no children/processes or external files. All DB handles close above.
  const rel = relative(fixtureParent, realpathSync(directory));
  if (!rel || isAbsolute(rel) || rel.startsWith("..") || !rel.startsWith("veyra-domain-integration-")) throw new Error("Fixture cleanup containment failed");
  const measure = (target: string): number => {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error("Fixture cleanup type failed");
    return (stat.blocks * 512) + (stat.isDirectory() ? readdirSync(target).reduce((sum, name) => sum + measure(join(target, name)), 0) : 0);
  };
  const allocatedBytes = measure(directory);
  rmSync(directory, { recursive: true });
  console.log(JSON.stringify({ cleanup: "removed-generated-closed-database-fixture", path: directory, allocatedBytes, regeneration: "veyra-domain-migrations.test.ts", protectedSourcePreserved: true }));
});
function fixture() {
  const project = projects.createProject("domain-integration");
  const owner = identity.createUser("domain-owner@example.test", "Domain Owner");
  organizations.addOrganizationMember(project.organization_id, owner.id, "admin");
  const scope = { organizationId: project.organization_id, ownerUserId: owner.id, hostId: "fixture-host", environmentId: "fixture-wsl", projectId: project.id, workspaceId: "fixture-workspace", bindingHash: "a".repeat(64), bindingEpoch: 1, visibility: "private" as const };
  const db = getDb();
  return { db, project, owner, scope };
}

describe("allocated Veyra domains on the production SQLite wrapper", () => {
  it("preserves original rows while catalog, learned recall and Dot persist through reopen", () => {
    const { db, scope, project } = fixture();
    const legacyTables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'veyra_%' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map(row => row.name);
    const before = legacyDigest(db, legacyTables);
    const ownerScope = { instanceId: (db.prepare("SELECT instance_id FROM veyra_installation_identity WHERE singleton=1").get() as { instance_id: string }).instance_id, organizationId: scope.organizationId, ownerUserId: scope.ownerUserId };
    const catalog = new ProjectCatalog({ db, transaction: (fn: () => unknown) => db.transaction(fn)(), checkpointAfterWrite,
      authorize: (requested: typeof ownerScope, action: string) => JSON.stringify(requested) === JSON.stringify(ownerScope) && ["projects:create", "projects:read", "projects:list", "roots:attach"].includes(action) });
    catalog.create(ownerScope, { label: "Folder project", roots: [{ id: "root", canonicalRootId: "fixture-root", hostId: "fixture-host", environmentId: "fixture-wsl", displayPath: "/fixture", isPrimary: true }] }, "folder-fixture");
    const source = { id: "fixture-turn", contentHash: "b".repeat(64), active: false, excluded: false, uncertain: false, idleEligible: true, kind: "transcript" };
    const adapter = { db, authorize: (requested: typeof scope) => JSON.stringify(requested) === JSON.stringify(scope), sources: () => source, checkpoint: checkpointAfterWrite };
    const memory = new MemoryLifecycle(adapter);
    memory.setPolicy(scope, { operationId: "policy", expectedRevision: 0, enabled: true, generate: true, useMemory: true, externalContext: false });
    memory.setChatPolicy(scope, "chat-a", { operationId: "chat", expectedRevision: 0, useMemory: true, contribute: true });
    const saved = memory.commitRecall(scope, { operationId: "recall", admission: memory.admit(scope, "chat-a", [source]), content: "Fixture user prefers short explanations.", model: "fixture-no-inference" });
    const dot = new DotRepository(db, fn => db.transaction(fn)());
    const dotScope = { organizationId: scope.organizationId, ownerUserId: scope.ownerUserId, projectId: project.id, executionBindingId: "fixture-workspace", executionBindingFingerprint: "a".repeat(64), conversationId: "chat-a" };
    dot.put("notification", { id: "notification", scope: dotScope, message: "Fixture notification" } as never, null);
    expect(legacyDigest(db, legacyTables)).toEqual(before);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    resetDbForTest();
    const reopened = getDb();
    const reloaded = new MemoryLifecycle({ ...adapter, db: reopened });
    expect(reloaded.recall(scope, "brand-new-chat").items).toHaveLength(1);
    expect(reloaded.operation(scope, "recall")).toMatchObject({ status: "committed" });
    expect(new DotRepository(reopened, fn => reopened.transaction(fn)()).get("notification", "notification", dotScope)).toMatchObject({ id: "notification" });
    expect(new ProjectCatalog({ db: reopened, transaction: (fn: () => unknown) => reopened.transaction(fn)(), checkpointAfterWrite, authorize: (requested: typeof ownerScope) => JSON.stringify(requested) === JSON.stringify(ownerScope) }).get(ownerScope, "folder-fixture").label).toBe("Folder project");
    const memoryId = reloaded.recall(scope, "brand-new-chat").items[0]!.id;
    reloaded.forget(scope, { operationId: "forget", memoryId, expectedVersion: 1 });
    expect(reloaded.recall(scope, "another-fresh-chat").items).toHaveLength(0);
    expect(reloaded.operation(scope, "forget")).toMatchObject({ status: "committed" });
    expect(saved.receipt.status).toBe("committed");
    expect(legacyDigest(reopened, legacyTables)).toEqual(before);
  });

  it("refuses an existing schema whose exclusive scheduler ownership index was removed", () => {
    const { db } = fixture();
    db.exec("DROP INDEX veyra_dot_job_owner");
    resetDbForTest();
    expect(() => getDb()).toThrow("Missing Veyra job ownership invariant");
  });

  it("enforces real organization and owner references on every new domain", () => {
    const { db, scope } = fixture();
    const invalidScope = JSON.stringify([scope.organizationId, "missing-owner", scope.hostId, scope.environmentId, scope.projectId, scope.workspaceId]);
    expect(() => db.prepare("INSERT INTO veyra_memory_policy VALUES (?,1,1,0,1,0)").run(invalidScope)).toThrow(/FOREIGN KEY/);
    const instanceId = (db.prepare("SELECT instance_id FROM veyra_installation_identity WHERE singleton=1").get() as { instance_id: string }).instance_id;
    expect(() => db.prepare("INSERT INTO veyra_workspace_projects(instance_id,organization_id,owner_user_id,id,label) VALUES (?,?,?,?,?)").run(instanceId, scope.organizationId, "missing-owner", "invalid", "invalid")).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare("INSERT INTO veyra_dot_records VALUES ('notification','invalid',?,?,?,?,?)").run(scope.organizationId, "missing-owner", "scope", 0, "{}")).toThrow(/FOREIGN KEY/);
  });
});