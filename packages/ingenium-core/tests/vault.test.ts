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
  getItemMetadata,
  initializeVault,
  initVault,
  isSealed,
  listItems,
  sealVault,
  unsealVault,
  updateItem,
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

  it("rejects when already initialized", () => {
    expect(initializeVault(testProject, "test-passphrase-12chars", "test-passphrase-12chars")).toEqual({ ok: true });
    expect(initializeVault(testProject, "test-passphrase-12chars", "test-passphrase-12chars")).toEqual({
      ok: false,
      error: "Vault is already initialized",
    });
  });
});
