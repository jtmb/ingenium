import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import * as protectedSettings from "../lib/tools/protected-settings.js";
import * as settings from "../lib/tools/settings.js";
import * as vault from "../lib/tools/vault.js";

const PASSPHRASE = "phase4e-vault-passphrase";
const SECRET_KEY = "oauth_gmail_client_secret" as const;
const LEGACY_SECRET = "phase4e-legacy-client-secret";
const EXISTING_SECRET = "phase4e-existing-client-secret";

const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;

let tempDir = "";
let globalProjectId = "";

beforeEach(() => {
  resetDbForTest();
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-phase4e-protected-settings-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "canonical", "data.db");
  process.env.INGENIUM_HOME = join(tempDir, "home");
  globalProjectId = createProject("global-default", true).id;
  vault.sealVault();
});

afterEach(() => {
  vault.sealVault();
  resetDbForTest();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";

  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
});

function insertLegacySecret(projectId: string, value: string): void {
  getDb().prepare(
    `INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
  ).run(projectId, SECRET_KEY, value);
}

function rawLegacySecret(projectId: string): string | undefined {
  return (getDb().prepare(
    "SELECT value FROM settings WHERE project_id = ? AND key = ?",
  ).get(projectId, SECRET_KEY) as { value: string } | undefined)?.value;
}

describe("Phase 4E protected OAuth settings", () => {
  it("migrates real plaintext after unseal, verifies decrypted equality, then removes the legacy source", () => {
    vault.initVault(globalProjectId, PASSPHRASE);
    insertLegacySecret(globalProjectId, LEGACY_SECRET);

    expect(vault.isSealed()).toBe(true);
    expect(protectedSettings.migrateLegacyOAuthClientSecret(globalProjectId, SECRET_KEY)).toMatchObject({
      status: "vault_unavailable",
    });
    expect(rawLegacySecret(globalProjectId)).toBe(LEGACY_SECRET);

    // Unsealing must trigger the migration synchronously after the durable
    // unseal commit; do not call the migration helper separately here.
    expect(vault.unsealVault(globalProjectId, PASSPHRASE).ok).toBe(true);

    // Read the destination through the decrypting API, not by inspecting
    // ciphertext, before asserting that the plaintext source is gone.
    expect(protectedSettings.getOAuthClientSecret(globalProjectId, SECRET_KEY)).toBe(LEGACY_SECRET);
    expect(rawLegacySecret(globalProjectId)).toBeUndefined();
    expect(getDb().prepare(
      "SELECT COUNT(*) AS count FROM protected_settings WHERE project_id = ? AND key = ?",
    ).get(globalProjectId, SECRET_KEY)).toEqual({ count: 1 });
  });

  it("retains a plaintext legacy value while the vault remains sealed", () => {
    vault.initVault(globalProjectId, PASSPHRASE);
    insertLegacySecret(globalProjectId, LEGACY_SECRET);

    const result = protectedSettings.migrateLegacyOAuthClientSecret(globalProjectId, SECRET_KEY);

    expect(result).toMatchObject({
      status: "vault_unavailable",
      metadata: { isSet: true, masked: true },
    });
    expect(rawLegacySecret(globalProjectId)).toBe(LEGACY_SECRET);
    expect(getDb().prepare(
      "SELECT COUNT(*) AS count FROM protected_settings WHERE project_id = ? AND key = ?",
    ).get(globalProjectId, SECRET_KEY)).toEqual({ count: 0 });
  });

  it("reports an existing protected/legacy mismatch without deleting either value", () => {
    expect(vault.initializeVault(globalProjectId, PASSPHRASE, PASSPHRASE).ok).toBe(true);
    expect(protectedSettings.updateOAuthClientSecret(
      globalProjectId,
      SECRET_KEY,
      "replace",
      EXISTING_SECRET,
    )).toMatchObject({ status: "ok" });
    insertLegacySecret(globalProjectId, LEGACY_SECRET);

    expect(protectedSettings.migrateLegacyOAuthClientSecret(globalProjectId, SECRET_KEY)).toMatchObject({
      status: "legacy_conflict",
      metadata: { isSet: true, masked: true },
    });
    expect(protectedSettings.getOAuthClientSecret(globalProjectId, SECRET_KEY)).toBe(EXISTING_SECRET);
    expect(rawLegacySecret(globalProjectId)).toBe(LEGACY_SECRET);
  });

  it("rejects plaintext writes to a protected key even when the caller names a non-global project", () => {
    const external = createProject("phase4e-external");

    expect(() => settings.setSetting(external.id, SECRET_KEY, LEGACY_SECRET)).toThrow(
      "OAuth client secrets must be stored in protected vault storage",
    );
    expect(rawLegacySecret(external.id)).toBeUndefined();
    expect(rawLegacySecret(globalProjectId)).toBeUndefined();
  });
});
