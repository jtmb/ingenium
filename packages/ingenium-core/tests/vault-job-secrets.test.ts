import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { createJob, finishJobRun, startJobRun, updateJob } from "../lib/tools/jobs.js";
import { configureVaultCryptoBufferObserverForTesting } from "../lib/tools/vault-crypto.js";
import {
  VaultJobSecretsUnavailableError,
  configureVaultJobSecretBufferObserverForTesting,
  createItem,
  deleteItem,
  initVault,
  resolveJobVaultSecrets,
  resolveJobProviderRuntime,
  sealVault,
  unsealVault,
  updateItem,
} from "../lib/tools/vault.js";

const passphrase = "vault job execution passphrase";
let directory = "";

function setup() {
  directory = mkdtempSync(join(tmpdir(), "ingenium-vault-job-secrets-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  const first = createProject("vault-job-secrets-first");
  const second = createProject("vault-job-secrets-second");
  initVault(first.id, passphrase);
  expect(unsealVault(first.id, passphrase).ok).toBe(true);
  return { db: getDb(process.env.INGENIUM_CORE_DB_PATH), first, second };
}

function createAuthorizedJob(projectId: string, value = "vault-job-secret-canary") {
  const itemId = createItem(projectId, "runner-secret", "api_key", value);
  const job = createJob(projectId, "vault runner", undefined, "agent", "prompt", undefined, undefined, 30, [itemId]);
  const run = startJobRun(projectId, job.id, "manual");
  if ("reason" in run) throw new Error(run.reason);
  return { itemId, job, runId: run.id, value };
}

function expectUnavailable(callback: () => unknown): void {
  try {
    callback();
    throw new Error("expected vault secrets to be unavailable");
  } catch (error) {
    expect(error).toBeInstanceOf(VaultJobSecretsUnavailableError);
    expect(error).toMatchObject({ code: "VAULT_SECRETS_UNAVAILABLE", message: "VAULT_SECRETS_UNAVAILABLE" });
  }
}

afterEach(() => {
  sealVault();
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  delete process.env.INGENIUM_CORE_DB_PATH;
});

describe("VAULT-101 execution-only core resolution", () => {
  it("returns run-owned Buffer handles and zeroes plaintext and DEKs on release", () => {
    const { db, first } = setup();
    const { itemId, job, runId, value } = createAuthorizedJob(first.id);
    const zeroed: Array<{ kind: string; buffer: Buffer }> = [];
    const restore = configureVaultJobSecretBufferObserverForTesting((kind, buffer) => {
      zeroed.push({ kind, buffer: Buffer.from(buffer) });
    });

    try {
      const resolved = resolveJobVaultSecrets(first.id, job.id, runId)!;
      expect(Buffer.isBuffer(resolved.secrets[0]!.value)).toBe(true);
      expect(resolved.secrets[0]!.value).toEqual(Buffer.from(value));
      resolved.release();
      expect(resolved.secrets[0]!.value.every((byte) => byte === 0)).toBe(true);
      expect(zeroed.map((entry) => entry.kind)).toEqual(expect.arrayContaining(["dek", "plaintext"]));
      expect(zeroed.every((entry) => entry.buffer.every((byte) => byte === 0))).toBe(true);
    } finally {
      restore();
    }

    const audit = db.prepare(
      "SELECT action, item_id, run_id, authorized_item_version FROM job_vault_runtime_audit WHERE project_id = ? ORDER BY id DESC LIMIT 1",
    ).get(first.id) as { action: string; item_id: string; run_id: string; authorized_item_version: number };
    expect(audit).toEqual({ action: "secret_read", item_id: itemId, run_id: runId, authorized_item_version: 1 });
    expect(JSON.stringify(db.prepare("SELECT * FROM vault_audit_log WHERE project_id = ?").all(first.id))).not.toContain(value);
  });

  it("zeroes AES-GCM decrypt chunks after each unwrap and payload decrypt", () => {
    const { first } = setup();
    const { job, runId } = createAuthorizedJob(first.id);
    const zeroed: Array<{ kind: string; bytes: Buffer }> = [];
    const restore = configureVaultCryptoBufferObserverForTesting((kind, buffer) => {
      zeroed.push({ kind, bytes: Buffer.from(buffer) });
    });
    try {
      const resolved = resolveJobVaultSecrets(first.id, job.id, runId)!;
      resolved.release();
      expect(zeroed.map((entry) => entry.kind)).toEqual(expect.arrayContaining(["decrypt_update", "decrypt_final"]));
      expect(zeroed.every((entry) => entry.bytes.every((byte) => byte === 0))).toBe(true);
    } finally {
      restore();
    }
  });

  it("does not require an unsealed vault for a job with no vault references", () => {
    const { first } = setup();
    const job = createJob(first.id, "ordinary job", undefined, "agent", "prompt");
    const run = startJobRun(first.id, job.id, "manual");
    if ("reason" in run) throw new Error(run.reason);
    sealVault();
    expect(resolveJobVaultSecrets(first.id, job.id, run.id)).toBeNull();
  });

  it("resolves only one explicitly service-granted provider connection", () => {
    const { db, first } = setup();
    const credential = "provider-runtime-canary";
    const itemId = createItem(first.id, "provider credential", "api_key", credential);
    const job = createJob(first.id, "provider job", undefined, "agent", "prompt", undefined, undefined, 30, [itemId]);
    const run = startJobRun(first.id, job.id, "manual");
    if ("reason" in run) throw new Error(run.reason);
    const connectionId = "organization-provider";
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO provider_connections
       (id, provider_key, owner_kind, organization_id, credential_item_id, display_name,
        provider_type, config_json, created_by_actor_type, created_at, updated_at)
       VALUES (?, 'provider-key', 'organization', ?, ?, 'Provider', 'managed', ?, 'system', ?, ?)`,
    ).run(connectionId, first.organization_id, itemId,
      JSON.stringify({ name: "Provider", npm: "@ai-sdk/openai-compatible", models: ["model"] }), now, now);
    expectUnavailable(() => resolveJobProviderRuntime(first.id, job.id, run.id));
    db.prepare(
      `INSERT INTO resource_grants
       (id, organization_id, resource_type, resource_id, grantee_kind, grantee_id,
        permissions_json, granted_by_actor_type, created_at, updated_at)
       VALUES (?, ?, 'provider_connection', ?, 'service', ?, '["execute"]', 'system', ?, ?)`,
    ).run("00000000-0000-4000-8000-000000000106", first.organization_id, connectionId,
      job.service_principal_id, now, now);

    const resolved = resolveJobProviderRuntime(first.id, job.id, run.id);
    expect(resolved).toMatchObject({ connectionId, providerKey: "provider-key" });
    expect(resolved.credential.toString("utf8")).toBe(credential);
    resolved.release();
    expect(resolved.credential.every((byte) => byte === 0)).toBe(true);
  });

  it("allows an explicitly service-granted installation provider backed by the active global vault", () => {
    const { db, first } = setup();
    db.prepare("UPDATE projects SET is_global = 1 WHERE id = ?").run(first.id);
    const credential = "installation-provider-canary";
    const itemId = createItem(first.id, "installation provider credential", "api_key", credential);
    const job = createJob(first.id, "installation provider job", undefined, "agent", "prompt");
    const run = startJobRun(first.id, job.id, "manual");
    if ("reason" in run) throw new Error(run.reason);
    const connectionId = "installation-provider";
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO provider_connections
       (id, provider_key, owner_kind, credential_item_id, display_name, provider_type,
        config_json, created_by_actor_type, created_at, updated_at)
       VALUES (?, 'installation-provider-key', 'installation', ?, 'Installation Provider', 'managed', ?, 'system', ?, ?)`,
    ).run(connectionId, itemId,
      JSON.stringify({ name: "Installation Provider", npm: "@ai-sdk/openai-compatible", models: ["model"] }), now, now);
    db.prepare(
      `INSERT INTO resource_grants
       (id, organization_id, resource_type, resource_id, grantee_kind, grantee_id,
        permissions_json, granted_by_actor_type, created_at, updated_at)
       VALUES (?, ?, 'provider_connection', ?, 'service', ?, '["execute"]', 'system', ?, ?)`,
    ).run("00000000-0000-4000-8000-000000000107", first.organization_id, connectionId,
      job.service_principal_id, now, now);

    const resolved = resolveJobProviderRuntime(first.id, job.id, run.id);
    expect(resolved).toMatchObject({ connectionId, providerKey: "installation-provider-key" });
    expect(resolved.credential.toString("utf8")).toBe(credential);
    resolved.release();
    expect(resolved.credential.every((byte) => byte === 0)).toBe(true);
  });

  it("uses one generic error for sealed, uninitialized, revoked, deleted, foreign, missing, expired, stale, and inactive access", () => {
    {
      const { first } = setup();
      const { job, runId } = createAuthorizedJob(first.id);
      sealVault();
      expectUnavailable(() => resolveJobVaultSecrets(first.id, job.id, runId));
    }

    // Isolate each durable state in a fresh database because the resolver's
    // access-denied audit is intentionally persistent evidence.
    for (const scenario of ["uninitialized", "revoked", "deleted", "foreign", "missing", "expired", "stale", "disabled", "archived"] as const) {
      sealVault();
      resetDbForTest();
      if (directory) rmSync(directory, { recursive: true, force: true });
      directory = "";
      const { db, first, second } = setup();
      const { itemId, job, runId } = createAuthorizedJob(first.id);
      if (scenario === "uninitialized") db.prepare("DELETE FROM vault_config WHERE id = 1").run();
      if (scenario === "revoked") db.prepare("UPDATE job_vault_references SET status = 'revoked' WHERE project_id = ? AND job_id = ?").run(first.id, job.id);
      if (scenario === "deleted") deleteItem(first.id, itemId);
      if (scenario === "foreign") {
        expectUnavailable(() => resolveJobVaultSecrets(second.id, job.id, runId));
        continue;
      }
      if (scenario === "missing") {
        db.pragma("foreign_keys = OFF");
        db.prepare("DELETE FROM vault_items WHERE project_id = ? AND id = ?").run(first.id, itemId);
        db.pragma("foreign_keys = ON");
      }
      if (scenario === "expired") db.prepare("UPDATE vault_items SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1_000).toISOString(), itemId);
      if (scenario === "stale") updateItem(first.id, itemId, "rotated-canary");
       if (scenario === "disabled") updateJob(first.id, job.id, { enabled: false }, job.revision);
      if (scenario === "archived") db.prepare("UPDATE projects SET archived_at = ? WHERE id = ?").run(new Date().toISOString(), first.id);
      expectUnavailable(() => resolveJobVaultSecrets(first.id, job.id, runId));
    }
  });

  it("enforces rotation freshness until an explicit same-ID PATCH refreshes the version", () => {
    const { db, first } = setup();
    const { itemId, job, runId } = createAuthorizedJob(first.id);
    updateItem(first.id, itemId, "rotated-value");
    expectUnavailable(() => resolveJobVaultSecrets(first.id, job.id, runId));
    finishJobRun(first.id, runId, "failed", -1);

    const refreshed = updateJob(first.id, job.id, { vault_item_ids: [itemId] }, job.revision);
    expect(refreshed.status).toBe("updated");
    if (refreshed.status !== "updated") throw new Error("expected refreshed job");
    expect(refreshed.job.vault_references[0]).toMatchObject({ item_id: itemId, authorized_item_version: 2, status: "authorized" });
    const refreshedRun = startJobRun(first.id, job.id, "manual");
    if ("reason" in refreshedRun) throw new Error(refreshedRun.reason);
    const resolved = resolveJobVaultSecrets(first.id, job.id, refreshedRun.id)!;
    expect(resolved.secrets[0]!.value).toEqual(Buffer.from("rotated-value"));
    resolved.release();
    expect(db.prepare(
      "SELECT count(*) AS count FROM job_vault_reference_audit WHERE job_id = ? AND action = 'authorized'",
    ).get(job.id)).toEqual({ count: 2 });
  });

  it("uses the earliest item expiry, lease, and job timeout deadline", () => {
    const { db, first } = setup();
    const { itemId, job, runId } = createAuthorizedJob(first.id);
    const expiresAt = Date.now() + 10_000;
    db.prepare("UPDATE vault_items SET expires_at = ?, lease_duration_seconds = 1 WHERE id = ?")
      .run(new Date(expiresAt).toISOString(), itemId);
    const resolved = resolveJobVaultSecrets(first.id, job.id, runId)!;
    expect(resolved.deadlineAt).toBeGreaterThan(Date.now());
    expect(resolved.deadlineAt).toBeLessThanOrEqual(Date.now() + 1_100);
    resolved.release();
  });
});
