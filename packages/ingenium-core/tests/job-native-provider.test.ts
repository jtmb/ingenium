import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { createUser } from "../lib/tools/identity.js";
import { createJob, finishJobRun, startJobRun, updateJob } from "../lib/tools/jobs.js";
import { configureAnonymousJobProvider, getJobProvider, nativeJobConnectionId, parseAnonymousJobProvider } from "../lib/tools/job-providers.js";
import { resolveJobProviderRuntime, sealVault, VaultJobSecretsUnavailableError } from "../lib/tools/vault.js";

let root = "";
let project: ReturnType<typeof createProject>;
let actor: { type: "user"; id: string };
function newJob() { return createJob(project.id, "Free response", undefined, "ingenium-chat", "Response only", undefined, undefined, 1); }
function start(id: string) {
  const run = startJobRun(project.id, id, "manual");
  if ("reason" in run) throw new Error(run.reason);
  return run;
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ingenium-job-native-"));
  process.env.INGENIUM_CORE_DB_PATH = join(root, "data.db");
  process.env.INGENIUM_HOME = root;
  resetDbForTest();
  project = createProject("job-native-provider");
  actor = { type: "user", id: createUser("job-native@example.test", "Job native").id };
});
afterEach(() => {
  sealVault(); resetDbForTest(); delete process.env.INGENIUM_CORE_DB_PATH; delete process.env.INGENIUM_HOME;
  rmSync(root, { recursive: true, force: true });
});

describe("job-bound native provider authorization", () => {
  it("configures a credential-free connection, leaves settings untouched and resolves while the vault is sealed", () => {
    const job = newJob();
    const db = getDb();
    const before = db.prepare("SELECT * FROM settings ORDER BY project_id, key").all();
    const configured = configureAnonymousJobProvider(project.id, job.id, job.revision, "beam-free", actor);
    expect(configured.job.revision).toBe(job.revision + 1);
    expect(configured.connection).toEqual({ kind: "anonymous", providerId: "opencode", modelId: "beam-free", authorized: true });
    const row = db.prepare("SELECT * FROM provider_connections WHERE id = ?").get(nativeJobConnectionId(job.id)) as Record<string, unknown>;
    expect(row).toMatchObject({ owner_kind: "organization", organization_id: project.organization_id,
      provider_key: "opencode", provider_type: "native", credential_item_id: null });
    const grant = db.prepare("SELECT * FROM resource_grants WHERE resource_id = ?").get(row.id) as Record<string, unknown>;
    expect(grant).toMatchObject({ grantee_kind: "service", grantee_id: job.service_principal_id,
      permissions_json: '["execute"]', granted_by_actor_type: "user", granted_by_actor_id: actor.id });
    const run = start(job.id);
    sealVault();
    const resolved = resolveJobProviderRuntime(project.id, job.id, run.id);
    expect(resolved).toMatchObject({ authentication: "anonymous", providerKey: "opencode", modelId: "beam-free" });
    expect(resolved).not.toHaveProperty("credential");
    resolved.release();
    expect(db.prepare("SELECT * FROM settings ORDER BY project_id, key").all()).toEqual(before);
    expect(db.prepare("SELECT action FROM resource_audit_events WHERE resource_id = ?").all(row.id))
      .toEqual([{ action: "job_provider_configured" }]);
  });

  it("does not select another job's connection when project execution principals are shared", () => {
    const first = newJob(); const second = newJob();
    expect(first.service_principal_id).toBe(second.service_principal_id);
    configureAnonymousJobProvider(project.id, first.id, 0, "beam-free", actor);
    configureAnonymousJobProvider(project.id, second.id, 0, "other-free", actor);
    expect(getJobProvider(project.id, first.id)?.modelId).toBe("beam-free");
    expect(getJobProvider(project.id, second.id)?.modelId).toBe("other-free");
    const firstRun = start(first.id);
    expect(resolveJobProviderRuntime(project.id, first.id, firstRun.id)).toMatchObject({ modelId: "beam-free" });
    expect(() => resolveJobProviderRuntime(project.id, second.id, firstRun.id)).toThrow(VaultJobSecretsUnavailableError);
    finishJobRun(project.id, firstRun.id, "success", 0);
    const secondRun = start(second.id);
    expect(resolveJobProviderRuntime(project.id, second.id, secondRun.id)).toMatchObject({ modelId: "other-free" });
  });

  it("rejects stale configuration without changing the connection or grant", () => {
    const job = newJob();
    configureAnonymousJobProvider(project.id, job.id, 0, "beam-free", actor);
    expect(() => configureAnonymousJobProvider(project.id, job.id, 0, "other-free", actor))
      .toThrow("JOB_REVISION_CONFLICT");
    expect(getJobProvider(project.id, job.id)?.modelId).toBe("beam-free");
  });

  it("blocks provider changes during a run and permits explicit revocation afterwards", () => {
    const job = newJob();
    const configured = configureAnonymousJobProvider(project.id, job.id, 0, "beam-free", actor);
    const run = start(job.id);
    expect(() => configureAnonymousJobProvider(project.id, job.id, configured.job.revision, null, actor))
      .toThrow("JOB_PROVIDER_BUSY");
    finishJobRun(project.id, run.id, "success", 0);
    const revoked = configureAnonymousJobProvider(project.id, job.id, configured.job.revision, null, actor);
    expect(revoked.connection).toMatchObject({ authorized: false });
    const deniedRun = start(job.id);
    expect(() => resolveJobProviderRuntime(project.id, job.id, deniedRun.id)).toThrow(VaultJobSecretsUnavailableError);
  });

  it.each(["expired", "revoked", "disabled", "wrong-job", "extra-options", "finished-run", "changed-job", "inactive-principal"])(
    "denies %s native runtime authorization", (failure) => {
      const job = newJob();
      const configured = configureAnonymousJobProvider(project.id, job.id, 0, "beam-free", actor);
      const run = start(job.id); const db = getDb(); const id = nativeJobConnectionId(job.id);
      if (failure === "expired") db.prepare("UPDATE resource_grants SET expires_at = '2000-01-01T00:00:00Z', revision = revision + 1 WHERE resource_id = ?").run(id);
      if (failure === "revoked") db.prepare("UPDATE resource_grants SET revoked_at = '2000-01-01T00:00:00Z', revision = revision + 1 WHERE resource_id = ?").run(id);
      if (failure === "disabled") db.prepare("UPDATE provider_connections SET enabled = 0 WHERE id = ?").run(id);
      if (failure === "wrong-job") db.prepare("UPDATE provider_connections SET config_json = ? WHERE id = ?")
        .run(JSON.stringify({ kind: "anonymous-zen-job", jobId: randomUUID(), modelId: "beam-free" }), id);
      if (failure === "extra-options") db.prepare("UPDATE provider_connections SET config_json = ? WHERE id = ?")
        .run(JSON.stringify({ kind: "anonymous-zen-job", jobId: job.id, modelId: "beam-free", baseURL: "https://example.test" }), id);
      if (failure === "finished-run") finishJobRun(project.id, run.id, "failed", 1);
      if (failure === "changed-job") updateJob(project.id, job.id, { prompt_template: "changed" }, configured.job.revision);
      if (failure === "inactive-principal") db.prepare("UPDATE service_principals SET status = 'revoked' WHERE id = ?").run(job.service_principal_id);
      if (failure === "wrong-job" || failure === "extra-options") expect(getJobProvider(project.id, job.id)).toBeNull();
      expect(() => resolveJobProviderRuntime(project.id, job.id, run.id)).toThrow(VaultJobSecretsUnavailableError);
    },
  );

  it("cannot reconfigure another user's private job or a foreign project", () => {
    const privateJob = createJob(project.id, "Private", undefined, "agent", "prompt", undefined, undefined, 1, [],
      { organizationId: project.organization_id, ownerUserId: createUser("other@example.test", "Other").id });
    expect(() => configureAnonymousJobProvider(project.id, privateJob.id, 0, "beam-free", actor)).toThrow("JOB_NOT_FOUND");
    const foreign = createProject("job-native-foreign");
    const own = newJob();
    expect(() => configureAnonymousJobProvider(foreign.id, own.id, 0, "beam-free", actor)).toThrow("JOB_NOT_FOUND");
  });

  it("does not replace another active provider grant", () => {
    const job = newJob(); const db = getDb(); const now = new Date().toISOString();
    db.prepare(`INSERT INTO provider_connections (id, provider_key, owner_kind, organization_id, display_name, provider_type,
      config_json, created_by_actor_type, created_at, updated_at) VALUES ('managed', 'managed', 'organization', ?, 'Managed',
      'managed', '{}', 'system', ?, ?)`).run(project.organization_id, now, now);
    db.prepare(`INSERT INTO resource_grants (id, organization_id, resource_type, resource_id, grantee_kind, grantee_id,
      permissions_json, granted_by_actor_type, created_at, updated_at)
      VALUES (?, ?, 'provider_connection', 'managed', 'service', ?, '["execute"]', 'system', ?, ?)`)
      .run(randomUUID(), project.organization_id, job.service_principal_id, now, now);
    expect(() => configureAnonymousJobProvider(project.id, job.id, 0, "beam-free", actor)).toThrow("JOB_PROVIDER_CONFLICT");
    expect(db.prepare("SELECT 1 FROM provider_connections WHERE id = ?").get(nativeJobConnectionId(job.id))).toBeUndefined();
  });

  it("rejects additional config fields, malformed model identifiers and nonmatching job bindings", () => {
    const job = newJob();
    expect(parseAnonymousJobProvider({ kind: "anonymous-zen-job", jobId: job.id, modelId: "beam-free", npm: "untrusted" }, job.id)).toBeNull();
    expect(parseAnonymousJobProvider({ kind: "anonymous-zen-job", jobId: "other", modelId: "beam-free" }, job.id)).toBeNull();
    expect(() => configureAnonymousJobProvider(project.id, job.id, 0, "../model", actor)).toThrow("INVALID_JOB_PROVIDER");
  });
});
