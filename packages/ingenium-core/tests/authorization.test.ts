import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { measureTestRunCleanup } from "../../../tests/test-run-cleanup-allocation.js";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createUser } from "../lib/tools/identity.js";
import { addOrganizationMember, addProjectMember, BOOTSTRAP_ORGANIZATION_ID, createOrganization } from "../lib/tools/organizations.js";
import { createProject } from "../lib/tools/projects.js";
import { listAuthorizedProjects, requireInstallationPermission, requirePrivateResourceAccess, requireProjectPermission } from "../lib/tools/authorization.js";

let directory = "";
const originalPath = process.env.INGENIUM_CORE_DB_PATH;

beforeEach(() => {
  resetDbForTest();
  directory = mkdtempSync(join(tmpdir(), "ingenium-authorization-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  getDb(process.env.INGENIUM_CORE_DB_PATH);
});

afterEach(() => {
  resetDbForTest();
  if (realpathSync(directory) !== resolve(directory) || !directory.startsWith(resolve(tmpdir()) + sep + "ingenium-authorization-"))
    throw new Error("Authorization fixture escaped its owned temporary leaf");
  const allocation = measureTestRunCleanup([directory]);
  if (allocation.sharedHardLinks.length) throw new Error("Authorization fixture has unaccounted hard links");
  rmSync(directory, { recursive: true });
  console.info("Authorization fixture removed", JSON.stringify(allocation));
  if (originalPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalPath;
});

describe("AUTH-102 authorization matrix", () => {
  it("denies project reads when an organization member has no project membership", () => {
    const user = createUser("unassigned-authz@example.test", "Unassigned");
    addOrganizationMember(BOOTSTRAP_ORGANIZATION_ID, user.id, "member");
    const project = createProject("unassigned-project");
    const principal = { type: "browser-user" as const, id: user.id, scopes: ["user:*"] };
    for (const resource of ["dashboard", "tasks", "context"]) {
      expect(requireProjectPermission(principal, project.id, resource, "read")).toMatchObject({ allowed: false, visible: false });
    }
    expect(listAuthorizedProjects(principal).some(item => item.id === project.id)).toBe(false);
  });

  it("preserves explicit viewer reads and organization administrator access", () => {
    const viewer = createUser("explicit-viewer@example.test", "Project viewer");
    const administrator = createUser("explicit-admin@example.test", "Organization administrator");
    addOrganizationMember(BOOTSTRAP_ORGANIZATION_ID, viewer.id, "member");
    addOrganizationMember(BOOTSTRAP_ORGANIZATION_ID, administrator.id, "admin");
    const project = createProject("explicit-role-project");
    addProjectMember(project.id, viewer.id, "viewer");
    expect(requireProjectPermission({ type: "browser-user", id: viewer.id, scopes: ["user:*"] }, project.id, "tasks", "read").allowed).toBe(true);
    expect(requireProjectPermission({ type: "browser-user", id: viewer.id, scopes: ["user:*"] }, project.id, "tasks", "write").allowed).toBe(false);
    expect(requireProjectPermission({ type: "browser-user", id: administrator.id, scopes: ["user:*"] }, project.id, "tasks", "admin").allowed).toBe(true);
  });

  it("intersects user role, project membership, token scope, and token bounds", () => {
    const owner = createUser("owner-authz@example.test", "Owner");
    const member = createUser("member-authz@example.test", "Member");
    const viewer = createUser("viewer-authz@example.test", "Viewer");
    addOrganizationMember(BOOTSTRAP_ORGANIZATION_ID, owner.id, "owner");
    addOrganizationMember(BOOTSTRAP_ORGANIZATION_ID, member.id, "member");
    addOrganizationMember(BOOTSTRAP_ORGANIZATION_ID, viewer.id, "viewer");
    const project = createProject("authorization-matrix");
    addProjectMember(project.id, member.id, "editor");
    addProjectMember(project.id, viewer.id, "editor");

    expect(requireProjectPermission({ type: "browser-user", id: owner.id, scopes: ["user:*"] }, project.id, "tasks", "admin").allowed).toBe(true);
    expect(requireProjectPermission({ type: "user-token", id: member.id, scopes: ["tasks:read"] }, project.id, "tasks", "write").allowed).toBe(false);
    expect(requireProjectPermission({ type: "user-token", id: member.id, scopes: ["tasks:write"] }, project.id, "tasks", "write").allowed).toBe(true);
    expect(requireProjectPermission({ type: "browser-user", id: viewer.id, scopes: ["user:*"] }, project.id, "tasks", "write").allowed).toBe(false);
    expect(requireProjectPermission({ type: "service-principal", id: "service", scopes: ["tasks:write"], organizationId: BOOTSTRAP_ORGANIZATION_ID, projectId: "foreign" }, project.id, "tasks", "write")).toMatchObject({ allowed: false, visible: false });
  });

  it("keeps compatibility installation-scoped and private resources fail closed", () => {
    expect(requireInstallationPermission({ type: "compatibility", id: "legacy", scopes: ["legacy:*"] }, "backups", "admin").allowed).toBe(true);
    expect(requireInstallationPermission({ type: "service-principal", id: "service", scopes: ["backups:admin"] }, "backups", "admin").allowed).toBe(false);
    expect(requirePrivateResourceAccess({ principal: { type: "service-principal", id: "service", scopes: ["private:read"] } })).toBe(false);
    expect(requirePrivateResourceAccess({ principal: { type: "user-token", id: "user-a", scopes: ["private:read"] }, ownerUserId: "user-b" })).toBe(false);
  });

  it("filters project listings without enumerating foreign organizations", () => {
    const user = createUser("listing-authz@example.test", "Listing");
    addOrganizationMember(BOOTSTRAP_ORGANIZATION_ID, user.id, "member");
    const visible = createProject("listing-visible");
    addProjectMember(visible.id, user.id, "viewer");
    const hiddenOrganization = createOrganization("Hidden", "hidden-authz");
    createProject("listing-hidden", false, hiddenOrganization);
    expect(listAuthorizedProjects({ type: "browser-user", id: user.id, scopes: ["user:*"] }).map((project) => project.name)).toEqual(["listing-visible"]);
  });
});
