import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../lib/db.js";
import * as core from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import {
  createItem,
  decryptItem,
  deleteItem,
  generatePassword,
  getEmptyVaultResetEligibility,
  getItemMetadata,
  initializeVault,
  initVault,
  isSealed,
  listItems,
  logAudit,
  resetEmptyVaultInitialization,
  sealVault,
  unsealVault,
  updateItem,
  validateVaultPassphrase,
} from "../lib/tools/vault.js";

const passphrase = "correct horse battery staple";
let tempDir: string;
let projectId: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-vault-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "vault.db");
  projectId = createProject("vault-test").id;
  initVault(projectId, passphrase);
});

afterAll(() => {
  sealVault();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("vault", () => {
  it("initializes a sealed configuration row", () => {
    const config = getDb().prepare("SELECT sealed FROM vault_config").get() as { sealed: number };
    expect(config.sealed).toBe(1);
  });

  it("unseals with the correct passphrase", () => {
    expect(unsealVault(projectId, passphrase).ok).toBe(true);
  });

  it("rejects an incorrect passphrase", () => {
    sealVault();
    expect(unsealVault(projectId, "wrong passphrase").ok).toBe(false);
    expect(unsealVault(projectId, passphrase).ok).toBe(true);
  });

  it("clears the in-memory key when sealed", () => {
    sealVault();
    expect(decryptItem(projectId, "missing-item")).toBeNull();
    expect(unsealVault(projectId, passphrase).ok).toBe(true);
  });

  it("encrypts and stores an item", () => {
    const itemId = createItem(projectId, "database", "api_key", "my-secret-value");
    expect(itemId).toBeTruthy();
    expect(getDb().prepare("SELECT encrypted FROM vault_items WHERE id = ?").get(itemId)).toBeTruthy();
  });

  it("returns metadata without sensitive fields", () => {
    const itemId = createItem(projectId, "metadata", "note", "private-value");
    const metadata = getItemMetadata(projectId, itemId)! as Record<string, unknown>;
    expect(metadata).not.toHaveProperty("value");
    expect(metadata).not.toHaveProperty("encrypted");
    expect(metadata).not.toHaveProperty("wrapped_kek");
  });

  it("decrypts an item to its original plaintext", () => {
    const itemId = createItem(projectId, "reveal", "note", "my-secret-value");
    expect(decryptItem(projectId, itemId)).toBe("my-secret-value");
  });

  it("does not decrypt while sealed", () => {
    const itemId = createItem(projectId, "sealed", "note", "private-value");
    sealVault();
    expect(decryptItem(projectId, itemId)).toBeNull();
    unsealVault(projectId, passphrase);
  });

  it("creates a new version when updating an item", () => {
    const itemId = createItem(projectId, "versioned", "note", "one");
    updateItem(projectId, itemId, "two");
    expect(getItemMetadata(projectId, itemId)).toMatchObject({ version: 2 });
    expect(decryptItem(projectId, itemId)).toBe("two");
  });

  it("soft-deletes an item", () => {
    const itemId = createItem(projectId, "delete", "note", "value");
    deleteItem(projectId, itemId);
    expect(getItemMetadata(projectId, itemId)).toBeNull();
    expect(getDb().prepare("SELECT access_policy FROM vault_items WHERE id = ?").get(itemId)).toMatchObject({ access_policy: '{"mode":"deleted"}' });
  });

  it("lists metadata without plaintext", () => {
    createItem(projectId, "list", "note", "my-secret-value");
    const items = listItems(projectId) as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(0);
    expect(JSON.stringify(items)).not.toContain("my-secret-value");
  });

  it("records audit events", () => {
    createItem(projectId, "audited", "note", "value");
    const events = getDb().prepare("SELECT event_type FROM vault_audit_log WHERE project_id = ?").all(projectId) as Array<{ event_type: string }>;
    expect(events.some((event) => event.event_type === "secret_created")).toBe(true);
  });

  it("stores no plaintext or user-controlled metadata in audit details", () => {
    const secret = "core-audit-secret-value";
    createItem(projectId, "name-with-sensitive-context", "note", secret);
    logAudit(projectId, "access_denied", null, "system", { secret });
    const details = getDb().prepare("SELECT details FROM vault_audit_log WHERE project_id = ? ORDER BY id DESC LIMIT 1").get(projectId) as { details: string };
    expect(details.details).toBe("{}");
    expect(details.details).not.toContain(secret);
  });

  it("shares the master-key configuration while keeping items project-isolated", () => {
    const otherProjectId = createProject("vault-other-project").id;
    const itemId = createItem(projectId, "project-one-only", "note", "project-one-secret");

    expect(listItems(otherProjectId)).toEqual([]);
    expect(getItemMetadata(otherProjectId, itemId)).toBeNull();

    sealVault();
    expect(unsealVault(otherProjectId, passphrase).ok).toBe(true);
    expect(decryptItem(projectId, itemId)).toBe("project-one-secret");
  });

  it("generates strong passwords", () => {
    const password = generatePassword();
    expect(password).toHaveLength(24);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
  });
});

describe("initializeVault", () => {
  const testProjectName = "init-test-project";
  let initializationTempDir: string;
  let initializationDbPath: string;
  let testProject: string;

  beforeEach(() => {
    core.resetDbForTest();
    initializationTempDir = mkdtempSync(join(tmpdir(), "ingenium-vault-initialize-"));
    initializationDbPath = join(initializationTempDir, "data.db");
    vi.stubEnv("INGENIUM_CORE_DB_PATH", initializationDbPath);
    sealVault();
    const db = core.getDb(initializationDbPath);
    testProject = createProject(testProjectName).id;
    db.prepare("DELETE FROM vault_config WHERE id = 1").run();
    db.prepare("DELETE FROM vault_items WHERE project_id = ?").run(testProject);
  });

  afterEach(() => {
    sealVault();
    core.resetDbForTest();
    vi.unstubAllEnvs();
    rmSync(initializationTempDir, { recursive: true, force: true });
  });

  it("succeeds on a fresh vault", () => {
    const result = initializeVault(testProject, "test-passphrase-12chars", "test-passphrase-12chars");
    expect(result.ok).toBe(true);
    expect(isSealed()).toBe(false);
  });

  it("rejects mismatched confirmation", () => {
    expect(initializeVault(testProject, "test-passphrase-12chars", "different confirmation")).toEqual({
      ok: false,
      error: "Passphrases do not match",
    });
  });

  it("rejects short passphrases", () => {
    expect(initializeVault(testProject, "too-short", "too-short")).toEqual({
      ok: false,
      error: "Passphrase must be at least 12 characters",
    });
  });

  it("uses one passphrase policy for direct initialization", () => {
    expect(validateVaultPassphrase("            ")).toEqual({ ok: false, error: "Passphrase must not be blank" });
    expect(validateVaultPassphrase("too-short")).toEqual({
      ok: false,
      error: "Passphrase must be at least 12 characters",
    });
    expect(() => initVault(testProject, "too-short")).toThrow("Passphrase must be at least 12 characters");
    expect(getDb(initializationDbPath).prepare("SELECT count(*) AS count FROM vault_config").get()).toEqual({ count: 0 });
  });

  it("rejects when already initialized", () => {
    expect(initializeVault(testProject, "test-passphrase-12chars", "test-passphrase-12chars")).toEqual({ ok: true });
    expect(initializeVault(testProject, "test-passphrase-12chars", "test-passphrase-12chars")).toEqual({
      ok: false,
      error: "Vault is already initialized",
    });
  });
});

describe("empty vault initialization reset", () => {
  let directory: string;
  let resetProject: ReturnType<typeof createProject>;

  beforeEach(() => {
    core.resetDbForTest();
    directory = mkdtempSync(join(tmpdir(), "ingenium-vault-empty-reset-"));
    vi.stubEnv("INGENIUM_CORE_DB_PATH", join(directory, "data.db"));
    resetProject = createProject(`empty-reset-${crypto.randomUUID()}`);
    initVault(resetProject.id, passphrase);
  });

  afterEach(() => {
    sealVault();
    core.resetDbForTest();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it("transactionally resets an initialized sealed vault with no key-dependent rows and records metadata-only audit evidence", () => {
    expect(getEmptyVaultResetEligibility()).toEqual({
      initialized: true,
      eligible: true,
      dependentRows: 0,
      blockers: [],
    });

    const result = resetEmptyVaultInitialization(resetProject.id, {
      type: "user",
      id: "installation-admin",
      requestId: "empty-reset-request",
    });

    expect(result).toEqual({ status: "reset" });
    expect(getDb().prepare("SELECT count(*) AS count FROM vault_config").get()).toEqual({ count: 0 });
    const audit = getDb().prepare(
      "SELECT action, actor_type, actor_id, request_id FROM resource_audit_events WHERE action = 'vault.empty_reset'",
    ).get();
    expect(audit).toEqual({
      action: "vault.empty_reset",
      actor_type: "user",
      actor_id: "installation-admin",
      request_id: "empty-reset-request",
    });
    expect(JSON.stringify({ result, audit })).not.toContain(passphrase);
  });

  it("blocks active and soft-deleted encrypted items across the service", () => {
    expect(unsealVault(resetProject.id, passphrase).ok).toBe(true);
    createItem(resetProject.id, "active", "note", "active-value");
    sealVault();
    expect(resetEmptyVaultInitialization(resetProject.id, { type: "user", id: "admin" })).toMatchObject({
      status: "blocked",
      eligibility: { blockers: ["encrypted_items"] },
    });

    expect(unsealVault(resetProject.id, passphrase).ok).toBe(true);
    const deleted = createItem(resetProject.id, "deleted", "note", "deleted-value");
    deleteItem(resetProject.id, deleted);
    getDb().prepare("DELETE FROM vault_items WHERE name = 'active'").run();
    sealVault();
    expect(resetEmptyVaultInitialization(resetProject.id, { type: "user", id: "admin" })).toMatchObject({
      status: "blocked",
      eligibility: { blockers: ["encrypted_items"] },
    });
  });

  it("blocks a provider credential reference even when its vault item is missing", () => {
    expect(unsealVault(resetProject.id, passphrase).ok).toBe(true);
    const itemId = createItem(resetProject.id, "provider", "api_key", "provider-value");
    const now = new Date().toISOString();
    getDb().prepare(`INSERT INTO provider_connections
      (id, provider_key, owner_kind, organization_id, credential_item_id, display_name, provider_type,
       config_json, enabled, created_by_actor_type, created_at, updated_at)
      VALUES (?, 'provider', 'organization', ?, ?, 'Provider', 'managed', '{}', 1, 'system', ?, ?)`)
      .run(crypto.randomUUID(), resetProject.organization_id, itemId, now, now);
    getDb().prepare("DELETE FROM vault_items WHERE id = ?").run(itemId);
    sealVault();

    expect(getEmptyVaultResetEligibility()).toMatchObject({
      eligible: false,
      blockers: ["credential_references"],
    });
    expect(resetEmptyVaultInitialization(resetProject.id, { type: "user", id: "admin" }).status).toBe("blocked");
  });

  it("blocks provider references retained only in configuration metadata", () => {
    getDb().prepare("INSERT INTO settings (project_id, key, value) VALUES (?, 'llm_provider_configs', ?)")
      .run(resetProject.id, JSON.stringify([{ id: "configured", credentialItemId: 42 }]));
    expect(getEmptyVaultResetEligibility()).toMatchObject({
      eligible: false,
      blockers: ["credential_references"],
    });

    getDb().prepare("DELETE FROM settings WHERE project_id = ? AND key = 'llm_provider_configs'").run(resetProject.id);
    const now = new Date().toISOString();
    getDb().prepare(`INSERT INTO provider_connections
      (id, provider_key, owner_kind, organization_id, display_name, provider_type,
       config_json, enabled, created_by_actor_type, created_at, updated_at)
      VALUES (?, 'configured', 'organization', ?, 'Configured', 'managed', ?, 1, 'system', ?, ?)`)
      .run(crypto.randomUUID(), resetProject.organization_id, JSON.stringify({ credentialItemId: "orphan" }), now, now);
    expect(getEmptyVaultResetEligibility()).toMatchObject({
      eligible: false,
      blockers: ["credential_references"],
    });
  });

  it("rolls back when a dependent row appears during the guarded delete", () => {
    getDb().exec(`CREATE TRIGGER inject_vault_item_before_empty_reset
      BEFORE DELETE ON vault_config BEGIN
        INSERT INTO vault_items (id, project_id, organization_id, name, type, encrypted, wrapped_kek)
        SELECT '00000000-0000-4000-8000-000000000001', id, organization_id, 'concurrent', 'note', X'01', X'02'
        FROM projects WHERE id = '${resetProject.id}';
      END`);

    expect(resetEmptyVaultInitialization(resetProject.id, { type: "user", id: "admin" })).toEqual({
      status: "concurrent_change",
    });
    expect(getDb().prepare("SELECT count(*) AS count FROM vault_config").get()).toEqual({ count: 1 });
    expect(getDb().prepare("SELECT count(*) AS count FROM vault_items").get()).toEqual({ count: 0 });
  });
});
