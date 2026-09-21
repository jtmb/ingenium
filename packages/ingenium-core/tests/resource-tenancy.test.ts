import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { authorization, getAuthenticationFoundationMigrationStatus, getDb, identity, organizations, projects, resetDbForTest, vault } from "../lib/index.js";

let directory = "";

beforeEach(() => {
  resetDbForTest();
  directory = mkdtempSync(join(tmpdir(), "ingenium-resource-tenancy-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data");
  getDb(process.env.INGENIUM_CORE_DB_PATH);
});

afterEach(() => {
  vault.sealVault();
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
  delete process.env.INGENIUM_CORE_DB_PATH;
});

describe("AUTH-104 resource ownership migrations", () => {
  it("applies complete 096 and 097 schemas idempotently", () => {
    expect(getAuthenticationFoundationMigrationStatus()).toMatchObject({
      "096": { complete: true, missing: [] },
      "097": { complete: true, missing: [] },
    });
    resetDbForTest();
    getDb(process.env.INGENIUM_CORE_DB_PATH);
    expect(getAuthenticationFoundationMigrationStatus()["097"].complete).toBe(true);
    expect(getDb().prepare("SELECT migration, ids_json, phase FROM resource_ownership_manifests ORDER BY migration").all()).toEqual([
      { migration: 96, ids_json: "[]", phase: "verified" },
      { migration: 97, ids_json: "[]", phase: "verified" },
    ]);
  });

  it("enforces same-organization and immutable vault ownership", () => {
    const user = identity.createUser("private-owner@example.test", "Private Owner");
    organizations.addOrganizationMember(organizations.BOOTSTRAP_ORGANIZATION_ID, user.id, "member");
    const project = projects.createProject("resource-tenancy-vault");
    expect(vault.initializeVault(project.id, "resource tenancy passphrase", "resource tenancy passphrase").ok).toBe(true);
    const itemId = vault.createItem(project.id, "private", "note", "plaintext", undefined, undefined, undefined, undefined, {
      organizationId: organizations.BOOTSTRAP_ORGANIZATION_ID,
      ownerKind: "user",
      ownerUserId: user.id,
    }, { type: "user", id: user.id, requestId: "create-private-item" });

    expect(getDb().prepare("SELECT id, version, owner_kind, owner_user_id FROM vault_items WHERE id = ?").get(itemId)).toEqual({
      id: itemId,
      version: 1,
      owner_kind: "user",
      owner_user_id: user.id,
    });
    expect(() => getDb().prepare("UPDATE vault_items SET owner_kind = 'organization', owner_user_id = NULL WHERE id = ?").run(itemId))
      .toThrow(/ownership transfer/);

    const foreignOrg = organizations.createOrganization("Foreign", "auth104-foreign");
    expect(() => getDb().prepare(
      `INSERT INTO vault_folders
       (id, project_id, organization_id, owner_kind, name, created_by_actor_type)
       VALUES ('foreign-folder', ?, ?, 'organization', 'Foreign', 'system')`,
    ).run(project.id, foreignOrg)).toThrow(/invalid vault folder owner/);
  });

  it("does not let an organization admin read user-private resources without a grant", () => {
    const owner = identity.createUser("owner-private@example.test", "Owner");
    const admin = identity.createUser("admin-private@example.test", "Admin");
    organizations.addOrganizationMember(organizations.BOOTSTRAP_ORGANIZATION_ID, owner.id, "member");
    organizations.addOrganizationMember(organizations.BOOTSTRAP_ORGANIZATION_ID, admin.id, "admin");
    const resource = {
      resourceType: "vault_item" as const,
      resourceId: "private-item",
      organizationId: organizations.BOOTSTRAP_ORGANIZATION_ID,
      ownerKind: "user" as const,
      ownerUserId: owner.id,
    };
    const adminPrincipal = { type: "browser-user" as const, id: admin.id, scopes: ["user:*"] };
    expect(authorization.requireOwnedResourcePermission(adminPrincipal, resource, "read")).toMatchObject({ allowed: false, visible: false });
    authorization.createResourceGrant({
      resource,
      granteeKind: "user",
      granteeId: admin.id,
      permissions: ["read"],
      actorType: "user",
      actorId: owner.id,
    });
    expect(authorization.requireOwnedResourcePermission(adminPrincipal, resource, "read").allowed).toBe(true);
    expect(authorization.requireOwnedResourcePermission(adminPrincipal, resource, "write").allowed).toBe(false);
  });

  it("requires provider credentials to have the same ownership boundary", () => {
    const owner = identity.createUser("provider-owner@example.test", "Provider Owner");
    organizations.addOrganizationMember(organizations.BOOTSTRAP_ORGANIZATION_ID, owner.id, "member");
    const project = projects.createProject("resource-tenancy-provider");
    expect(vault.initializeVault(project.id, "resource tenancy passphrase", "resource tenancy passphrase").ok).toBe(true);
    const privateItemId = vault.createItem(project.id, "private provider", "api_key", "private-key", undefined, undefined, undefined, undefined, {
      organizationId: organizations.BOOTSTRAP_ORGANIZATION_ID,
      ownerKind: "user",
      ownerUserId: owner.id,
    });
    const organizationItemId = vault.createItem(project.id, "organization provider", "api_key", "organization-key");
    const now = new Date().toISOString();
    const insertProvider = getDb().prepare(
      `INSERT INTO provider_connections
       (id, provider_key, owner_kind, organization_id, owner_user_id, credential_item_id, display_name,
        provider_type, config_json, created_by_actor_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'managed', '{}', 'system', ?, ?)`,
    );

    insertProvider.run("user-provider", "user-provider", "user", organizations.BOOTSTRAP_ORGANIZATION_ID,
      owner.id, privateItemId, "User provider", now, now);
    expect(() => getDb().prepare("UPDATE provider_connections SET credential_item_id = ? WHERE id = ?")
      .run(organizationItemId, "user-provider")).toThrow(/invalid provider credential/);
    expect(() => insertProvider.run("installation-provider", "installation-provider", "installation", null,
      null, organizationItemId, "Installation provider", now, now)).toThrow(/invalid provider owner or credential/);
    expect(() => getDb().prepare(
      `INSERT INTO provider_connections
       (id, provider_key, owner_kind, display_name, provider_type, config_json, created_by_actor_type, created_at, updated_at)
       VALUES ('secret-provider', 'secret-provider', 'installation', 'Secret provider', 'managed', ?, 'system', ?, ?)`,
    ).run(JSON.stringify({ options: { bearerToken: "must-not-persist" } }), now, now)).toThrow(/must not contain credentials/);
  });

  it("enforces organization-qualified mail cache ownership", () => {
    const accountId = "shared-account";
    getDb().prepare(
      `INSERT INTO mail_accounts
       (id, organization_id, owner_kind, email, name, provider, auth_type, config_json, created_by_actor_type, created_at, updated_at)
       VALUES (?, ?, 'organization', 'mail@example.test', 'Mail', 'gmail', 'oauth2', '{}', 'system', ?, ?)`,
    ).run(accountId, organizations.BOOTSTRAP_ORGANIZATION_ID, new Date().toISOString(), new Date().toISOString());
    getDb().prepare(
      `INSERT INTO email_cache (organization_id, account_id, folder, uid, subject)
       VALUES (?, ?, 'Inbox/Real', 'uid-1', 'subject')`,
    ).run(organizations.BOOTSTRAP_ORGANIZATION_ID, accountId);
    const foreignOrg = organizations.createOrganization("Mail Foreign", "auth104-mail-foreign");
    expect(() => getDb().prepare(
      `INSERT INTO email_cache (organization_id, account_id, folder, uid, subject)
       VALUES (?, ?, 'Inbox/Real', 'uid-2', 'foreign')`,
    ).run(foreignOrg, accountId)).toThrow(/email cache account must belong to organization/);
    expect(getDb().prepare("SELECT folder FROM email_cache WHERE account_id = ?").get(accountId)).toEqual({ folder: "Inbox/Real" });
  });

  it("preserves legacy cache account identity with a normalized compatibility account", () => {
    const legacyPath = join(directory, "legacy-mail.db");
    const legacy = new Database(legacyPath);
    const migrations = resolve(import.meta.dirname ?? __dirname, "../data/migrations");
    const files = readdirSync(migrations)
      .filter((file) => /^\d{3}_.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= 96 && !file.includes("_upgrade"))
      .sort();
    expect(files).toHaveLength(96);
    for (const file of files) legacy.exec(readFileSync(join(migrations, file), "utf8"));
    legacy.prepare("INSERT INTO email_cache (account_id, folder, uid, subject) VALUES (?, ?, ?, ?)")
      .run("legacy-cache-account", "Inbox/Legacy", "legacy-uid", "legacy subject");
    legacy.close();

    resetDbForTest();
    process.env.INGENIUM_CORE_DB_PATH = legacyPath;

    const upgraded = getDb(legacyPath);
    expect(upgraded.prepare("SELECT id, organization_id, owner_kind, hidden FROM mail_accounts WHERE id = ?")
      .get("legacy-cache-account")).toEqual({
        id: "legacy-cache-account",
        organization_id: organizations.BOOTSTRAP_ORGANIZATION_ID,
        owner_kind: "organization",
        hidden: 1,
      });
    expect(upgraded.prepare("SELECT account_id, folder, uid, subject, organization_id FROM email_cache WHERE account_id = ?")
      .get("legacy-cache-account")).toEqual({
        account_id: "legacy-cache-account",
        folder: "Inbox/Legacy",
        uid: "legacy-uid",
        subject: "legacy subject",
        organization_id: organizations.BOOTSTRAP_ORGANIZATION_ID,
      });
    const manifest = upgraded.prepare("SELECT counts_json, ids_json FROM resource_ownership_manifests WHERE migration = 97").get() as {
      counts_json: string;
      ids_json: string;
    };
    expect(JSON.parse(manifest.counts_json)).toMatchObject({ mail_accounts: 1, cache: 1, sync_state: 0 });
    expect(JSON.parse(manifest.ids_json)).toEqual([
      `email_cache:["${organizations.BOOTSTRAP_ORGANIZATION_ID}","legacy-cache-account","Inbox/Legacy","legacy-uid"]`,
      'mail_account:["legacy-cache-account"]',
    ]);
  });

  it("backfills provider metadata without copying secret-bearing fields", () => {
    const legacyPath = join(directory, "legacy-provider.db");
    const legacy = new Database(legacyPath);
    const migrations = resolve(import.meta.dirname ?? __dirname, "../data/migrations");
    const files = readdirSync(migrations)
      .filter((file) => /^\d{3}_.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= 95 && !file.includes("_upgrade"))
      .sort();
    for (const file of files) legacy.exec(readFileSync(join(migrations, file), "utf8"));
    legacy.prepare("INSERT INTO projects (id, name, path, is_global, created_at, updated_at, organization_id) VALUES (?, ?, ?, 1, ?, ?, ?)")
      .run("00000000-0000-4000-8000-000000000104", "legacy-provider-global", "/legacy-provider-global", new Date().toISOString(), new Date().toISOString(), organizations.BOOTSTRAP_ORGANIZATION_ID);
    const canary = "auth104-provider-secret-canary";
    legacy.prepare("INSERT INTO settings (project_id, key, value) VALUES (?, 'llm_provider_configs', ?)").run(
      "00000000-0000-4000-8000-000000000104",
      JSON.stringify([{ id: "legacy-provider", name: "Legacy Provider", npm: "@ai-sdk/openai", models: ["legacy-model"], defaultModel: "legacy-model", enabled: true, apiKey: canary, token: canary, clientSecret: canary, password: canary }]),
    );
    legacy.close();

    resetDbForTest();
    process.env.INGENIUM_CORE_DB_PATH = legacyPath;
    const upgraded = getDb(legacyPath);
    const provider = upgraded.prepare("SELECT id, config_json, credential_item_id, enabled FROM provider_connections WHERE provider_key = 'legacy-provider'").get() as { id: string; config_json: string; credential_item_id: string | null; enabled: number };
    expect(provider.id).toBe("installation:installation:shared:legacy-provider");
    expect(provider.credential_item_id).toBeNull();
    expect(provider.enabled).toBe(0);
    expect(provider.config_json).not.toContain(canary);
    expect(provider.config_json).not.toMatch(/apiKey|api_key|token|clientSecret|client_secret|password/i);
    expect(JSON.parse(provider.config_json)).toMatchObject({ id: "legacy-provider", name: "Legacy Provider", ownerKind: "installation" });
    expect(JSON.stringify(upgraded.prepare("SELECT * FROM provider_connections").all())).not.toContain(canary);
    expect(JSON.stringify(upgraded.prepare("SELECT * FROM resource_audit_events").all())).not.toContain(canary);
  });
});
