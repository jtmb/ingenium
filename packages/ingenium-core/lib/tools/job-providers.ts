import { randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import { getJob } from "./jobs.js";

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
export const JOB_NATIVE_PROVIDER_ID = "opencode";

export type AnonymousJobProvider = { kind: "anonymous-zen-job"; jobId: string; modelId: string };
export class JobProviderConfigurationError extends Error {
  constructor(readonly code: "JOB_NOT_FOUND" | "JOB_REVISION_CONFLICT" | "JOB_PROVIDER_BUSY" | "JOB_PROVIDER_CONFLICT" | "INVALID_JOB_PROVIDER",
    readonly currentRevision?: number) {
    super(code);
    this.name = "JobProviderConfigurationError";
  }
}
export function nativeJobConnectionId(jobId: string): string { return "job-native:" + jobId; }

/** Only this fixed, credential-free connection contract may use anonymous Zen. */
export function parseAnonymousJobProvider(value: unknown, jobId: string): AnonymousJobProvider | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "jobId,kind,modelId"
    || record.kind !== "anonymous-zen-job" || record.jobId !== jobId
    || typeof record.modelId !== "string" || !MODEL_ID.test(record.modelId)) return null;
  return { kind: "anonymous-zen-job", jobId, modelId: record.modelId };
}

export type JobProviderMetadata = {
  kind: "anonymous" | "managed";
  providerId: string;
  modelId?: string;
  authorized: boolean;
};

/** A fixed metadata projection; never return provider config or credential references. */
export function getJobProvider(projectId: string, jobId: string): JobProviderMetadata | null {
  const job = getJob(projectId, jobId);
  if (!job) return null;
  const rows = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(`
    SELECT connection.id, connection.provider_key, connection.provider_type, connection.config_json,
           connection.owner_kind, connection.organization_id, connection.credential_item_id, connection.enabled, grant_row.revoked_at, grant_row.expires_at, grant_row.permissions_json
    FROM provider_connections connection JOIN resource_grants grant_row
      ON grant_row.resource_type = 'provider_connection' AND grant_row.resource_id = connection.id
     AND grant_row.organization_id = ? AND grant_row.grantee_kind = 'service' AND grant_row.grantee_id = ?
    WHERE connection.owner_kind IN ('organization', 'installation')
      AND (connection.organization_id = ? OR connection.owner_kind = 'installation')
    AND (connection.provider_type <> 'native' OR connection.id = ?)
    AND (connection.id = ? OR (grant_row.revoked_at IS NULL AND (grant_row.expires_at IS NULL OR grant_row.expires_at > ?)))
    ORDER BY connection.id LIMIT 2
  `).all(job.organization_id, job.service_principal_id, job.organization_id, nativeJobConnectionId(jobId), nativeJobConnectionId(jobId), new Date().toISOString()) as Array<{
    id: string; provider_key: string; provider_type: string; config_json: string; enabled: number;
    owner_kind: string; organization_id: string | null; credential_item_id: string | null;
    revoked_at: string | null; expires_at: string | null; permissions_json: string;
  }>;
  if (rows.length !== 1) return null;
  const row = rows[0]!;
  let parsed: unknown; let permissions: unknown;
  try { parsed = JSON.parse(row.config_json); permissions = JSON.parse(row.permissions_json); } catch { return null; }
  const native = row.id === nativeJobConnectionId(jobId) && row.provider_key === JOB_NATIVE_PROVIDER_ID
    && row.provider_type === "native" && row.owner_kind === "organization"
    && row.organization_id === job.organization_id && row.credential_item_id === null
    ? parseAnonymousJobProvider(parsed, jobId) : null;
  if (row.provider_type === "native" && !native) return null;
  const authorized = row.enabled === 1 && row.revoked_at === null
    && (row.expires_at === null || row.expires_at > new Date().toISOString())
    && Array.isArray(permissions) && permissions.some((value) => ["execute", "read", "admin", "*"].includes(value));
  return { kind: native ? "anonymous" : "managed", providerId: row.provider_key,
    ...(native ? { modelId: native.modelId } : {}), authorized };
}

/**
 * Configure only a job-bound anonymous Zen connection for its execution principal.
 * Browser authorization, step-up and live free-catalog validation happen at the API.
 * The transaction rechecks job revision, organization/principal identity and active runs.
 */
export function configureAnonymousJobProvider(projectId: string, jobId: string, expectedRevision: number,
  modelId: string | null, actor: { type: "user"; id: string }) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || modelId !== null && !MODEL_ID.test(modelId) || !actor.id) {
    throw new JobProviderConfigurationError("INVALID_JOB_PROVIDER");
  }
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const job = getJob(projectId, jobId);
    if (!job || job.visibility === "private" && job.owner_user_id !== actor.id) {
      throw new JobProviderConfigurationError("JOB_NOT_FOUND");
    }
    if (job.revision !== expectedRevision) throw new JobProviderConfigurationError("JOB_REVISION_CONFLICT", job.revision);
    const principal = db.prepare("SELECT organization_id, status FROM service_principals WHERE id = ?")
      .get(job.service_principal_id) as { organization_id: string; status: string } | undefined;
    if (!principal || principal.organization_id !== job.organization_id || principal.status !== "active") {
      throw new JobProviderConfigurationError("JOB_PROVIDER_CONFLICT");
    }
    if (db.prepare("SELECT 1 FROM job_runs WHERE job_id = ? AND status IN ('running', 'queued') LIMIT 1").get(jobId)) {
      throw new JobProviderConfigurationError("JOB_PROVIDER_BUSY");
    }
    const id = nativeJobConnectionId(jobId);
    const now = new Date().toISOString();
    const otherGrants = db.prepare(`
      SELECT connection.* FROM resource_grants grant_row LEFT JOIN provider_connections connection ON connection.id = grant_row.resource_id
      WHERE grant_row.organization_id = ? AND grant_row.resource_type = 'provider_connection'
        AND grant_row.grantee_kind = 'service' AND grant_row.grantee_id = ? AND grant_row.resource_id <> ?
        AND grant_row.revoked_at IS NULL AND (grant_row.expires_at IS NULL OR grant_row.expires_at > ?)
    `).all(job.organization_id, job.service_principal_id, id, now) as Array<Record<string, unknown>>;
    for (const other of otherGrants) {
      let config: unknown;
      try { config = JSON.parse(String(other.config_json)); } catch { /* conflict below */ }
      const otherId = config && typeof config === "object" ? (config as Record<string, unknown>).jobId : undefined;
      const bound = typeof otherId === "string" ? parseAnonymousJobProvider(config, otherId) : null;
      const otherJob = typeof otherId === "string" ? db.prepare("SELECT 1 FROM jobs WHERE id = ? AND organization_id = ? AND service_principal_id = ?")
        .get(otherId, job.organization_id, job.service_principal_id) : null;
      if (!bound || !otherJob || other.id !== nativeJobConnectionId(bound.jobId)
        || other.owner_kind !== "organization" || other.organization_id !== job.organization_id
        || other.provider_type !== "native" || other.provider_key !== JOB_NATIVE_PROVIDER_ID || other.credential_item_id !== null) {
        throw new JobProviderConfigurationError("JOB_PROVIDER_CONFLICT");
      }
    }
    const existing = db.prepare("SELECT owner_kind, organization_id, provider_type, provider_key, credential_item_id, config_json FROM provider_connections WHERE id = ?")
      .get(id) as { owner_kind: string; organization_id: string; provider_type: string; provider_key: string;
        credential_item_id: string | null; config_json: string } | undefined;
    if (existing) {
      let config: unknown; try { config = JSON.parse(existing.config_json); } catch { /* fail closed below */ }
      if (existing.owner_kind !== "organization" || existing.organization_id !== job.organization_id
        || existing.provider_type !== "native" || existing.provider_key !== JOB_NATIVE_PROVIDER_ID
        || existing.credential_item_id !== null || !parseAnonymousJobProvider(config, jobId)) {
        throw new JobProviderConfigurationError("JOB_PROVIDER_CONFLICT");
      }
    }
    if (modelId !== null) {
      const config = JSON.stringify({ kind: "anonymous-zen-job", jobId, modelId } satisfies AnonymousJobProvider);
      db.prepare(`
        INSERT INTO provider_connections
          (id, provider_key, owner_kind, organization_id, display_name, provider_type, config_json,
           enabled, created_by_actor_type, created_by_actor_id, created_at, updated_at)
        VALUES (?, 'opencode', 'organization', ?, 'Free Zen for job', 'native', ?, 1, 'user', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, enabled = 1,
          revision = provider_connections.revision + 1, updated_at = excluded.updated_at
      `).run(id, job.organization_id, config, actor.id, now, now);
      db.prepare(`
        INSERT INTO resource_grants
          (id, organization_id, resource_type, resource_id, grantee_kind, grantee_id, permissions_json,
           granted_by_actor_type, granted_by_actor_id, created_at, updated_at)
        VALUES (?, ?, 'provider_connection', ?, 'service', ?, '["execute"]', 'user', ?, ?, ?)
        ON CONFLICT(organization_id, resource_type, resource_id, grantee_kind, grantee_id)
        DO UPDATE SET permissions_json = '["execute"]', revoked_at = NULL, expires_at = NULL,
          revision = resource_grants.revision + 1, granted_by_actor_type = 'user',
          granted_by_actor_id = excluded.granted_by_actor_id, updated_at = excluded.updated_at
      `).run(randomUUID(), job.organization_id, id, job.service_principal_id, actor.id, now, now);
    } else if (existing) {
      db.prepare("UPDATE provider_connections SET enabled = 0, revision = revision + 1, updated_at = ? WHERE id = ?").run(now, id);
      db.prepare(`
        UPDATE resource_grants SET revoked_at = ?, revision = revision + 1, updated_at = ?
        WHERE organization_id = ? AND resource_type = 'provider_connection' AND resource_id = ?
          AND grantee_kind = 'service' AND grantee_id = ? AND revoked_at IS NULL
      `).run(now, now, job.organization_id, id, job.service_principal_id);
    }
    db.prepare("UPDATE jobs SET revision = revision + 1, updated_at = ? WHERE project_id = ? AND id = ? AND revision = ?")
      .run(now, projectId, jobId, expectedRevision);
    db.prepare(`
      INSERT INTO resource_audit_events
        (id, organization_id, project_id, resource_type, resource_id, action, actor_type, actor_id, outcome, created_at)
      VALUES (?, ?, ?, 'provider_connection', ?, ?, 'user', ?, 'success', ?)
    `).run(randomUUID(), job.organization_id, projectId, id, modelId === null ? "job_provider_revoked" : "job_provider_configured", actor.id, now);
    return { job: getJob(projectId, jobId)!, connection: getJobProvider(projectId, jobId) };
  });
  checkpointAfterWrite();
  return result;
}
