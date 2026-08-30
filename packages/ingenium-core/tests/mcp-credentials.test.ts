import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { getAuthenticationFoundationMigrationStatus, getDb, resetDbForTest } from "../lib/db.js";
import { createUser } from "../lib/tools/identity.js";
import { createOrganization } from "../lib/tools/organizations.js";
import { createProject } from "../lib/tools/projects.js";
import { createServicePrincipal } from "../lib/tools/security-tokens.js";
import {
  createMcpCredential,
  incrementServicePrincipalSecurityEpoch,
  listMcpCredentials,
  resolveMcpCredential,
  revokeMcpCredential,
  rotateMcpCredential,
} from "../lib/tools/mcp-credentials.js";

let directory = "";

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-mcp-credentials-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data");
  resetDbForTest();
});

afterEach(() => {
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
});

function fixture(kind: "service" | "runtime" | "repository-sync" = "service") {
  getDb(process.env.INGENIUM_CORE_DB_PATH);
  const user = createUser("mcp-owner@example.test", "MCP Owner");
  const organizationId = createOrganization("MCP Org", "mcp-org");
  getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "INSERT INTO organization_memberships (organization_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, 'owner', 'active', ?, ?)",
  ).run(organizationId, user.id, new Date().toISOString(), new Date().toISOString());
  const project = createProject("mcp-project", false, organizationId);
  const servicePrincipalId = createServicePrincipal(organizationId, `mcp-${kind}`);
  return createMcpCredential({
    servicePrincipalId,
    kind,
    audience: kind === "runtime" ? "runtime" : kind === "repository-sync" ? "repository-sync" : "mcp",
    name: `${kind} fixture`,
    scopes: kind === "runtime" ? ["child-mcp:runtime"] : kind === "repository-sync" ? ["projects:read", "repository:sync"] : ["projects:read"],
    organizationId,
    projectId: project.id,
    workspaceId: "workspace-fixture",
    launcherWorktree: "/workspace/fixture",
    expiresAt: new Date(Date.now() + 60_000),
    createdByUserId: user.id,
  });
}

describe("AUTH-107 MCP credentials", () => {
  it("installs the exact migration 100 schema idempotently", () => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const objectNames = [
      "service_principals", "mcp_credentials", "idx_mcp_credentials_principal", "idx_mcp_credentials_project",
      "mcp_credentials_scope_insert", "mcp_credentials_immutable",
    ];
    const before = database.prepare(
      `SELECT name, type, sql FROM sqlite_master WHERE name IN (${objectNames.map(() => "?").join(",")}) ORDER BY name`,
    ).all(...objectNames);
    expect(getAuthenticationFoundationMigrationStatus()["100"]).toEqual({ any: true, complete: true, missing: [] });

    resetDbForTest();
    const reopened = getDb(process.env.INGENIUM_CORE_DB_PATH);

    expect(reopened.prepare(
      `SELECT name, type, sql FROM sqlite_master WHERE name IN (${objectNames.map(() => "?").join(",")}) ORDER BY name`,
    ).all(...objectNames)).toEqual(before);
    expect(getAuthenticationFoundationMigrationStatus()["100"]).toEqual({ any: true, complete: true, missing: [] });
  });

  it("rejects a partial migration 100 table without repairing it", () => {
    const path = process.env.INGENIUM_CORE_DB_PATH!;
    const database = getDb(path);
    database.exec(`DROP TRIGGER mcp_credentials_scope_insert;
      DROP TRIGGER mcp_credentials_immutable;
      DROP INDEX idx_mcp_credentials_principal;
      DROP INDEX idx_mcp_credentials_project;
      DROP TABLE mcp_credentials;
      CREATE TABLE mcp_credentials (id TEXT PRIMARY KEY, name TEXT, token_prefix TEXT);`);
    resetDbForTest();

    expect(() => getDb(path)).toThrow(/Migration 100 is in a PARTIAL state.*mcp_credentials\.service_principal_id column/);
    resetDbForTest();
    const raw = new Database(path);
    expect(raw.prepare("PRAGMA table_info('mcp_credentials')").all().map((column: any) => column.name))
      .toEqual(["id", "name", "token_prefix"]);
    raw.close();
  });

  it("rejects a complete-looking migration 100 table with an ambiguous constraint signature", () => {
    const path = process.env.INGENIUM_CORE_DB_PATH!;
    const database = getDb(path);
    const names = [
      "mcp_credentials", "idx_mcp_credentials_principal", "idx_mcp_credentials_project",
      "mcp_credentials_scope_insert", "mcp_credentials_immutable",
    ];
    const definitions = new Map((database.prepare(
      `SELECT name, sql FROM sqlite_master WHERE name IN (${names.map(() => "?").join(",")})`,
    ).all(...names) as Array<{ name: string; sql: string }>).map(({ name, sql }) => [name, sql]));
    const tableSql = definitions.get("mcp_credentials")!.replace("CHECK(length(id) = 36)", "CHECK(length(id) > 0)");
    expect(tableSql).not.toBe(definitions.get("mcp_credentials"));
    database.exec(`DROP TRIGGER mcp_credentials_scope_insert;
      DROP TRIGGER mcp_credentials_immutable;
      DROP INDEX idx_mcp_credentials_principal;
      DROP INDEX idx_mcp_credentials_project;
      DROP TABLE mcp_credentials;
      ${tableSql};
      ${definitions.get("idx_mcp_credentials_principal")};
      ${definitions.get("idx_mcp_credentials_project")};
      ${definitions.get("mcp_credentials_scope_insert")};
      ${definitions.get("mcp_credentials_immutable")};`);
    resetDbForTest();

    expect(() => getDb(path)).toThrow(/Migration 100 is in a PARTIAL state.*mcp_credentials definition/);
  });

  it("stores only a hash, returns plaintext once, and enforces audience, expiry, and security epoch", () => {
    const created = fixture();
    const persisted = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT token_hash FROM mcp_credentials WHERE id = ?").get(created.id) as { token_hash: string };
    expect(persisted.token_hash).not.toContain(created.token);
    expect(listMcpCredentials(created.createdByUserId)[0]).not.toHaveProperty("token");
    expect(resolveMcpCredential(created.token, "runtime")).toBeUndefined();
    expect(resolveMcpCredential(created.token, "mcp")?.launcherWorktree).toBe("/workspace/fixture");
    expect(resolveMcpCredential(created.token, "mcp", new Date(created.expiresAt))).toBeUndefined();
    incrementServicePrincipalSecurityEpoch(created.servicePrincipalId);
    expect(resolveMcpCredential(created.token, "mcp")).toBeUndefined();
    resetDbForTest();
    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).not.toThrow();
  });

  it("rotates and revokes immediately", () => {
    const created = fixture();
    const rotated = rotateMcpCredential(created.id, created.createdByUserId);
    expect(resolveMcpCredential(created.token, "mcp")).toBeUndefined();
    expect(resolveMcpCredential(rotated.token, "mcp")?.rotatedToId).toBeNull();
    expect(revokeMcpCredential(rotated.id, created.createdByUserId)).toBe(true);
    expect(resolveMcpCredential(rotated.token, "mcp")).toBeUndefined();
  });

  it("rejects wrong organization grants and repository-sync privilege expansion", () => {
    const created = fixture("repository-sync");
    expect(created.scopes).toEqual(["projects:read", "repository:sync"]);
    const foreignOrganization = createOrganization("Foreign MCP", "foreign-mcp");
    const foreignProject = createProject("foreign-mcp-project", false, foreignOrganization);
    expect(() => createMcpCredential({
      servicePrincipalId: created.servicePrincipalId,
      kind: "repository-sync",
      audience: "repository-sync",
      name: "too broad",
      scopes: ["projects:read", "repository:sync", "vault:read"],
      organizationId: created.organizationId,
      projectId: foreignProject.id,
      workspaceId: "workspace-fixture",
      launcherWorktree: "/workspace/fixture",
      expiresAt: new Date(Date.now() + 60_000),
      createdByUserId: created.createdByUserId,
    })).toThrow();
  });

  it("atomically creates a service principal when human issuance omits one", () => {
    const existing = fixture();
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const before = (db.prepare("SELECT count(*) AS count FROM service_principals").get() as { count: number }).count;
    const input = {
      kind: "service" as const,
      audience: "mcp" as const,
      name: "generated principal credential",
      scopes: ["projects:read"],
      organizationId: existing.organizationId,
      projectId: existing.projectId,
      workspaceId: "workspace-fixture",
      launcherWorktree: "/workspace/fixture",
      expiresAt: new Date(Date.now() + 60_000),
      createdByUserId: existing.createdByUserId,
    };

    const created = createMcpCredential(input);

    expect(created.servicePrincipalId).not.toBe(existing.servicePrincipalId);
    expect((db.prepare("SELECT count(*) AS count FROM service_principals").get() as { count: number }).count).toBe(before + 1);
    expect(() => createMcpCredential({ ...input, name: "invalid generated principal", projectId: randomUUID() })).toThrow();
    expect((db.prepare("SELECT count(*) AS count FROM service_principals").get() as { count: number }).count).toBe(before + 1);
  });
});
