import { createHash, randomBytes, randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";

export const RUNTIME_STATES = [
  "ABSENT", "PROVISIONING", "STARTING", "READY", "IDLE", "STOPPING", "STOPPED", "FAILED", "REVOKED",
] as const;
export type RuntimeState = typeof RUNTIME_STATES[number];
export type RuntimeLaunchAudience = "web" | "cli" | "vscode";

export interface RuntimeLimits {
  cpuMillis: number;
  memoryBytes: number;
  pidsLimit: number;
  diskBytes: number;
  processLimit: number;
}

export interface AuthorizedWorkspace {
  id: string;
  organizationId: string;
  projectId: string;
  ownerUserId: string;
  storagePath: string;
  storageMappingHash: string;
  status: "authorized" | "revoked";
  securityEpoch: number;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeInstance extends RuntimeLimits {
  id: string;
  workspaceId: string;
  organizationId: string;
  projectId: string;
  ownerUserId: string;
  state: RuntimeState;
  revision: number;
  leaseExpiresAt: string | null;
  idleExpiresAt: string | null;
  absoluteExpiresAt: string | null;
  backendName: string;
  backendContainerId: string | null;
  securityEpoch: number;
  activeConnections: number;
  activeGenerations: number;
  lastAuthenticatedActivityAt: string | null;
  lastBackendHealthAt: string | null;
  createdAt: string;
  updatedAt: string;
  stoppedAt: string | null;
}

export interface RuntimeLaunchTicket {
  id: string;
  runtimeId: string;
  organizationId: string;
  projectId: string;
  ownerUserId: string;
  audience: RuntimeLaunchAudience;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export interface RuntimeBrowserSession {
  id: string;
  runtimeId: string;
  workspaceId: string;
  organizationId: string;
  projectId: string;
  ownerUserId: string;
  authSessionId: string;
  audience: RuntimeLaunchAudience;
  origin: string;
  host: string;
  generation: number;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export class RuntimeConflictError extends Error {
  constructor(readonly code: "REVISION_CONFLICT" | "STATE_CONFLICT" | "LEASE_CONFLICT" | "QUOTA_EXCEEDED" | "SCOPE_UNAVAILABLE") {
    super(code);
  }
}

type WorkspaceRow = {
  id: string; organization_id: string; project_id: string; owner_user_id: string; storage_path: string;
  storage_mapping_hash: string; status: "authorized" | "revoked"; security_epoch: number; created_at: string; updated_at: string;
};
type RuntimeRow = {
  id: string; workspace_id: string; organization_id: string; project_id: string; owner_user_id: string;
  state: RuntimeState; revision: number; lease_expires_at: string | null; idle_expires_at: string | null;
  absolute_expires_at: string | null; cpu_millis: number; memory_bytes: number; pids_limit: number;
  disk_bytes: number; process_limit: number; backend_name: string; backend_container_id: string | null;
  security_epoch: number; active_connections: number; active_generations: number;
  last_authenticated_activity_at: string | null; last_backend_health_at: string | null;
  created_at: string; updated_at: string; stopped_at: string | null;
};
type RuntimeLaunchTicketRow = {
  id: string; runtime_id: string; organization_id: string; project_id: string; owner_user_id: string;
  audience: RuntimeLaunchAudience; expires_at: string; consumed_at: string | null; created_at: string;
};
type RuntimeBrowserTicketRow = {
  id: string; runtime_id: string; workspace_id: string; organization_id: string; project_id: string;
  owner_user_id: string; auth_session_id: string; audience: RuntimeLaunchAudience; origin: string; host: string;
  launcher_origin: string;
  generation: number; expires_at: string; consumed_at: string | null; created_at: string;
};
type RuntimeBrowserSessionRow = RuntimeBrowserTicketRow & {
  last_seen_at: string; revoked_at: string | null;
};

const ACTIVE_STATES: readonly RuntimeState[] = ["PROVISIONING", "STARTING", "READY", "IDLE", "STOPPING"];
const TRANSITIONS: Readonly<Record<RuntimeState, readonly RuntimeState[]>> = {
  ABSENT: ["PROVISIONING", "REVOKED"],
  PROVISIONING: ["STARTING", "FAILED", "STOPPING", "REVOKED"],
  STARTING: ["READY", "FAILED", "STOPPING", "REVOKED"],
  READY: ["IDLE", "STOPPING", "FAILED", "REVOKED"],
  IDLE: ["READY", "STOPPING", "FAILED", "REVOKED"],
  STOPPING: ["STOPPED", "FAILED", "REVOKED"],
  STOPPED: ["PROVISIONING", "REVOKED"],
  FAILED: ["PROVISIONING", "STOPPING", "REVOKED"],
  REVOKED: [],
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function workspaceStorageMappingHash(workspaceId: string, storagePath: string): string {
  return sha256(`${workspaceId}\0${storagePath}`);
}

function normalizeText(value: string, maximum: number, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`Invalid ${label}`);
  return normalized;
}

function normalizeStoragePath(value: string): string {
  const path = normalizeText(value, 1024, "workspace storage path");
  if (!path.startsWith("/") || path.includes("/../") || path.endsWith("/..") || path.includes("/./") || path.endsWith("/.")) {
    throw new Error("Invalid workspace storage path");
  }
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function normalizeRuntimeRootDomain(value: string): string {
  const domain = value.trim().toLowerCase().replace(/^\./, "");
  if (domain.length < 3 || domain.length > 200 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(domain)
    || domain.includes("..") || !domain.includes(".")) throw new Error("Invalid runtime root domain");
  return domain;
}

export function runtimeAudienceOrigin(runtimeId: string, audience: RuntimeLaunchAudience, rootDomain: string): { origin: string; host: string } {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runtimeId)
    || !["web", "cli", "vscode"].includes(audience)) throw new Error("Invalid runtime browser scope");
  const host = `${audience}--${runtimeId.toLowerCase()}.${normalizeRuntimeRootDomain(rootDomain)}`;
  return { host, origin: `https://${host}` };
}

function workspaceDto(row: WorkspaceRow): AuthorizedWorkspace {
  return {
    id: row.id, organizationId: row.organization_id, projectId: row.project_id, ownerUserId: row.owner_user_id,
    storagePath: row.storage_path, storageMappingHash: row.storage_mapping_hash, status: row.status,
    securityEpoch: row.security_epoch, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function runtimeDto(row: RuntimeRow): RuntimeInstance {
  return {
    id: row.id, workspaceId: row.workspace_id, organizationId: row.organization_id, projectId: row.project_id,
    ownerUserId: row.owner_user_id, state: row.state, revision: row.revision, leaseExpiresAt: row.lease_expires_at,
    idleExpiresAt: row.idle_expires_at, absoluteExpiresAt: row.absolute_expires_at, cpuMillis: row.cpu_millis,
    memoryBytes: row.memory_bytes, pidsLimit: row.pids_limit, diskBytes: row.disk_bytes, processLimit: row.process_limit,
    backendName: row.backend_name, backendContainerId: row.backend_container_id, securityEpoch: row.security_epoch,
    activeConnections: row.active_connections, activeGenerations: row.active_generations,
    lastAuthenticatedActivityAt: row.last_authenticated_activity_at, lastBackendHealthAt: row.last_backend_health_at,
    createdAt: row.created_at, updatedAt: row.updated_at, stoppedAt: row.stopped_at,
  };
}

function launchTicketDto(row: RuntimeLaunchTicketRow): RuntimeLaunchTicket {
  return {
    id: row.id,
    runtimeId: row.runtime_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    audience: row.audience,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

export function authorizeWorkspace(input: {
  id: string; organizationId: string; projectId: string; ownerUserId: string; storagePath: string;
}): AuthorizedWorkspace {
  const id = normalizeText(input.id, 256, "workspace ID");
  const storagePath = normalizeStoragePath(input.storagePath);
  const timestamp = new Date().toISOString();
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    db.prepare(`INSERT INTO authorized_workspaces
      (id, organization_id, project_id, owner_user_id, storage_path, storage_mapping_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.organizationId, input.projectId, input.ownerUserId, storagePath,
        workspaceStorageMappingHash(id, storagePath), timestamp, timestamp);
    return workspaceDto(db.prepare("SELECT * FROM authorized_workspaces WHERE id = ?").get(id) as WorkspaceRow);
  });
  checkpointAfterWrite();
  return result;
}

export function getAuthorizedWorkspace(id: string): AuthorizedWorkspace | undefined {
  const row = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT * FROM authorized_workspaces WHERE id = ?").get(id) as WorkspaceRow | undefined;
  return row ? workspaceDto(row) : undefined;
}

export function listAuthorizedWorkspaces(ownerUserId?: string): AuthorizedWorkspace[] {
  const rows = ownerUserId
    ? getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT * FROM authorized_workspaces WHERE owner_user_id = ? ORDER BY created_at, id").all(ownerUserId)
    : getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT * FROM authorized_workspaces ORDER BY created_at, id").all();
  return (rows as WorkspaceRow[]).map(workspaceDto);
}

function assertLimits(limits: RuntimeLimits): void {
  const integers = Object.values(limits);
  if (!integers.every(Number.isSafeInteger) || limits.cpuMillis < 100 || limits.cpuMillis > 64_000
    || limits.memoryBytes < 134_217_728 || limits.memoryBytes > 274_877_906_944
    || limits.pidsLimit < 16 || limits.pidsLimit > 65_536 || limits.diskBytes < 67_108_864
    || limits.diskBytes > 1_099_511_627_776 || limits.processLimit < 16 || limits.processLimit > limits.pidsLimit) {
    throw new Error("Invalid runtime limits");
  }
}

export function createRuntimeInstance(workspaceId: string, limits: RuntimeLimits): RuntimeInstance {
  assertLimits(limits);
  const runtime = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const workspace = db.prepare("SELECT * FROM authorized_workspaces WHERE id = ? AND status = 'authorized'").get(workspaceId) as WorkspaceRow | undefined;
    if (!workspace) throw new RuntimeConflictError("SCOPE_UNAVAILABLE");
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    db.prepare(`INSERT INTO runtime_instances
      (id, workspace_id, organization_id, project_id, owner_user_id, cpu_millis, memory_bytes, pids_limit,
       disk_bytes, process_limit, backend_name, security_epoch, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, workspace.id, workspace.organization_id, workspace.project_id, workspace.owner_user_id,
        limits.cpuMillis, limits.memoryBytes, limits.pidsLimit, limits.diskBytes, limits.processLimit,
         `ingenium-runtime-${id.replaceAll("-", "")}`, workspace.security_epoch, timestamp, timestamp);
    db.prepare("INSERT INTO runtime_browser_generations (runtime_id, generation, updated_at) VALUES (?, ?, ?)")
      .run(id, workspace.security_epoch, timestamp);
    return runtimeDto(db.prepare("SELECT * FROM runtime_instances WHERE id = ?").get(id) as RuntimeRow);
  });
  checkpointAfterWrite();
  return runtime;
}

export function bindRuntimeCapability(runtimeId: string, credentialId: string): void {
  execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const runtime = db.prepare("SELECT * FROM runtime_instances WHERE id = ?").get(runtimeId) as RuntimeRow | undefined;
    const credential = db.prepare("SELECT expires_at FROM mcp_credentials WHERE id = ?").get(credentialId) as { expires_at: string } | undefined;
    if (!runtime || !credential) throw new RuntimeConflictError("SCOPE_UNAVAILABLE");
    const timestamp = new Date().toISOString();
    const prior = db.prepare("SELECT id, mcp_credential_id FROM runtime_capability_bindings WHERE runtime_id = ? AND revoked_at IS NULL")
      .get(runtime.id) as { id: string; mcp_credential_id: string } | undefined;
    if (prior) {
      db.prepare("UPDATE mcp_credentials SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(timestamp, prior.mcp_credential_id);
      db.prepare("UPDATE runtime_capability_bindings SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(timestamp, prior.id);
    }
    db.prepare(`INSERT INTO runtime_capability_bindings
      (id, runtime_id, mcp_credential_id, organization_id, project_id, owner_user_id, workspace_id, security_epoch, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), runtime.id, credentialId, runtime.organization_id, runtime.project_id, runtime.owner_user_id,
        runtime.workspace_id, runtime.security_epoch, credential.expires_at, timestamp);
  });
  checkpointAfterWrite();
}

export function getRuntimeInstance(id: string): RuntimeInstance | undefined {
  const row = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT * FROM runtime_instances WHERE id = ?").get(id) as RuntimeRow | undefined;
  return row ? runtimeDto(row) : undefined;
}

export function getRuntimeForWorkspace(workspaceId: string): RuntimeInstance | undefined {
  const row = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT * FROM runtime_instances WHERE workspace_id = ?").get(workspaceId) as RuntimeRow | undefined;
  return row ? runtimeDto(row) : undefined;
}

export function listRuntimeInstances(ownerUserId?: string): RuntimeInstance[] {
  const rows = ownerUserId
    ? getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT * FROM runtime_instances WHERE owner_user_id = ? ORDER BY created_at, id").all(ownerUserId)
    : getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT * FROM runtime_instances ORDER BY created_at, id").all();
  return (rows as RuntimeRow[]).map(runtimeDto);
}

function appendEvent(runtime: RuntimeRow, eventType: string, actorType: "user" | "manager" | "system", actorId: string, fromState?: RuntimeState): void {
  getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(`INSERT INTO runtime_activity_events
    (id, runtime_id, event_type, from_state, to_state, revision, actor_type, actor_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), runtime.id, eventType, fromState ?? null, runtime.state, runtime.revision, actorType,
      normalizeText(actorId, 128, "runtime actor"), new Date().toISOString());
}

export function transitionRuntime(input: {
  id: string; expectedRevision: number; toState: RuntimeState; actorType: "user" | "manager" | "system"; actorId: string;
  backendContainerId?: string | null; idleExpiresAt?: Date | null; absoluteExpiresAt?: Date | null; maxActiveRuntimes?: number;
}): RuntimeInstance {
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const current = db.prepare("SELECT * FROM runtime_instances WHERE id = ?").get(input.id) as RuntimeRow | undefined;
    if (!current) throw new RuntimeConflictError("SCOPE_UNAVAILABLE");
    if (current.revision !== input.expectedRevision) throw new RuntimeConflictError("REVISION_CONFLICT");
    if (!TRANSITIONS[current.state].includes(input.toState)) throw new RuntimeConflictError("STATE_CONFLICT");
    if (input.toState === "PROVISIONING" && input.maxActiveRuntimes !== undefined) {
      if (!Number.isSafeInteger(input.maxActiveRuntimes) || input.maxActiveRuntimes < 1) throw new Error("Invalid runtime quota");
      const active = (db.prepare(
        `SELECT count(*) AS count FROM runtime_instances WHERE owner_user_id = ? AND id <> ? AND state IN (${ACTIVE_STATES.map(() => "?").join(",")})`,
      ).get(current.owner_user_id, current.id, ...ACTIVE_STATES) as { count: number }).count;
      if (active >= input.maxActiveRuntimes) throw new RuntimeConflictError("QUOTA_EXCEEDED");
    }
    const timestamp = new Date().toISOString();
    const backend = input.backendContainerId === undefined ? current.backend_container_id : input.backendContainerId;
    if (backend !== null && !/^[0-9a-f]{64}$/.test(backend)) throw new Error("Invalid backend identity");
    const revoked = input.toState === "REVOKED";
    const releaseLease = input.toState === "STOPPED" || input.toState === "FAILED" || revoked;
    const changed = db.prepare(`UPDATE runtime_instances SET state = ?, revision = revision + 1,
      backend_container_id = ?, idle_expires_at = ?, absolute_expires_at = ?,
       active_connections = CASE WHEN ? THEN 0 ELSE active_connections END,
       active_generations = CASE WHEN ? THEN 0 ELSE active_generations END,
      lease_owner_hash = CASE WHEN ? THEN NULL ELSE lease_owner_hash END,
      lease_expires_at = CASE WHEN ? THEN NULL ELSE lease_expires_at END,
      security_epoch = security_epoch + CASE WHEN ? THEN 1 ELSE 0 END,
      stopped_at = CASE WHEN ? THEN ? ELSE stopped_at END, updated_at = ?
      WHERE id = ? AND revision = ?`)
      .run(input.toState, backend, input.idleExpiresAt?.toISOString() ?? current.idle_expires_at,
        input.absoluteExpiresAt?.toISOString() ?? current.absolute_expires_at,
        releaseLease ? 1 : 0, releaseLease ? 1 : 0, releaseLease ? 1 : 0, releaseLease ? 1 : 0, revoked ? 1 : 0,
        input.toState === "STOPPED" || revoked ? 1 : 0, timestamp, timestamp, current.id, current.revision);
    if (changed.changes !== 1) throw new RuntimeConflictError("REVISION_CONFLICT");
    const updated = db.prepare("SELECT * FROM runtime_instances WHERE id = ?").get(current.id) as RuntimeRow;
    if (revoked) {
      db.prepare("UPDATE runtime_browser_generations SET generation = generation + 1, updated_at = ? WHERE runtime_id = ?")
        .run(timestamp, current.id);
      db.prepare("UPDATE runtime_browser_sessions SET revoked_at = ? WHERE runtime_id = ? AND revoked_at IS NULL")
        .run(timestamp, current.id);
    }
    appendEvent(updated, revoked ? "revoked" : "state_changed", input.actorType, input.actorId, current.state);
    return runtimeDto(updated);
  });
  checkpointAfterWrite();
  return result;
}

export function claimRuntimeLease(input: {
  id: string; expectedRevision: number; ownerToken: string; ttlMs: number; actorId: string; now?: Date;
}): RuntimeInstance {
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const current = db.prepare("SELECT * FROM runtime_instances WHERE id = ?").get(input.id) as RuntimeRow | undefined;
    const timestamp = input.now ?? new Date();
    if (!current) throw new RuntimeConflictError("SCOPE_UNAVAILABLE");
    if (current.revision !== input.expectedRevision) throw new RuntimeConflictError("REVISION_CONFLICT");
    if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1_000 || input.ttlMs > 300_000
      || !/^[A-Za-z0-9_-]{32,512}$/.test(input.ownerToken)) throw new Error("Invalid runtime lease");
    if (current.lease_expires_at && current.lease_expires_at > timestamp.toISOString()) throw new RuntimeConflictError("LEASE_CONFLICT");
    const changed = db.prepare(`UPDATE runtime_instances SET lease_owner_hash = ?, lease_expires_at = ?,
      revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`)
      .run(sha256(input.ownerToken), new Date(timestamp.getTime() + input.ttlMs).toISOString(), timestamp.toISOString(), current.id, current.revision);
    if (changed.changes !== 1) throw new RuntimeConflictError("REVISION_CONFLICT");
    const updated = db.prepare("SELECT * FROM runtime_instances WHERE id = ?").get(current.id) as RuntimeRow;
    appendEvent(updated, "lease_claimed", "manager", input.actorId);
    return runtimeDto(updated);
  });
  checkpointAfterWrite();
  return result;
}

export function recordRuntimeActivity(input: {
  id: string; expectedRevision: number; kind: "connection_opened" | "connection_closed" | "generation_started" | "generation_finished";
  actorId: string; now?: Date; idleLeaseMs?: number;
}): RuntimeInstance {
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const current = db.prepare("SELECT * FROM runtime_instances WHERE id = ?").get(input.id) as RuntimeRow | undefined;
    if (!current) throw new RuntimeConflictError("SCOPE_UNAVAILABLE");
    if (current.revision !== input.expectedRevision) throw new RuntimeConflictError("REVISION_CONFLICT");
    if (current.state !== "READY" && current.state !== "IDLE") throw new RuntimeConflictError("STATE_CONFLICT");
    const connections = input.kind === "connection_opened" ? current.active_connections + 1
      : input.kind === "connection_closed" ? current.active_connections - 1 : current.active_connections;
    const generations = input.kind === "generation_started" ? current.active_generations + 1
      : input.kind === "generation_finished" ? current.active_generations - 1 : current.active_generations;
    if (connections < 0 || generations < 0) throw new RuntimeConflictError("STATE_CONFLICT");
    const timestamp = (input.now ?? new Date()).toISOString();
    if (input.idleLeaseMs !== undefined && (!Number.isSafeInteger(input.idleLeaseMs) || input.idleLeaseMs < 1_000)) {
      throw new Error("Invalid idle runtime lease");
    }
    const requestedIdleExpiry = input.idleLeaseMs === undefined
      ? current.idle_expires_at
      : new Date(new Date(timestamp).getTime() + input.idleLeaseMs).toISOString();
    const idleExpiresAt = requestedIdleExpiry && current.absolute_expires_at
      ? [requestedIdleExpiry, current.absolute_expires_at].sort()[0]!
      : requestedIdleExpiry;
    db.prepare(`UPDATE runtime_instances SET active_connections = ?, active_generations = ?,
      last_authenticated_activity_at = ?, idle_expires_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`)
      .run(connections, generations, timestamp, idleExpiresAt, timestamp, current.id, current.revision);
    const updated = db.prepare("SELECT * FROM runtime_instances WHERE id = ?").get(current.id) as RuntimeRow;
    appendEvent(updated, input.kind, "user", input.actorId);
    return runtimeDto(updated);
  });
  checkpointAfterWrite();
  return result;
}

export function recordRuntimeHealth(id: string, expectedRevision: number, backendContainerId: string, now = new Date()): RuntimeInstance {
  if (!/^[0-9a-f]{64}$/.test(backendContainerId)) throw new Error("Invalid backend identity");
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const current = db.prepare("SELECT * FROM runtime_instances WHERE id = ?").get(id) as RuntimeRow | undefined;
    if (!current) throw new RuntimeConflictError("SCOPE_UNAVAILABLE");
    if (current.revision !== expectedRevision) throw new RuntimeConflictError("REVISION_CONFLICT");
    db.prepare(`UPDATE runtime_instances SET backend_container_id = ?, last_backend_health_at = ?, revision = revision + 1,
      updated_at = ? WHERE id = ? AND revision = ?`).run(backendContainerId, now.toISOString(), now.toISOString(), id, expectedRevision);
    return runtimeDto(db.prepare("SELECT * FROM runtime_instances WHERE id = ?").get(id) as RuntimeRow);
  });
  checkpointAfterWrite();
  return result;
}

export function markExpiredRuntimeOrphans(now = new Date()): RuntimeInstance[] {
  const changed = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const rows = db.prepare(`SELECT * FROM runtime_instances
      WHERE state IN ('PROVISIONING','STARTING','STOPPING') AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`)
      .all(now.toISOString()) as RuntimeRow[];
    const results: RuntimeInstance[] = [];
    for (const row of rows) {
      db.prepare(`UPDATE runtime_instances SET state = 'FAILED', revision = revision + 1, lease_owner_hash = NULL,
        lease_expires_at = NULL, updated_at = ? WHERE id = ? AND revision = ?`).run(now.toISOString(), row.id, row.revision);
      const updated = db.prepare("SELECT * FROM runtime_instances WHERE id = ?").get(row.id) as RuntimeRow;
      appendEvent(updated, "orphaned", "system", "runtime-reconciler", row.state);
      results.push(runtimeDto(updated));
    }
    return results;
  });
  if (changed.length > 0) checkpointAfterWrite();
  return changed;
}

export function getRuntimeCapabilityCredentialId(runtimeId: string): string | undefined {
  return (getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT mcp_credential_id FROM runtime_capability_bindings WHERE runtime_id = ? AND revoked_at IS NULL",
  ).get(runtimeId) as { mcp_credential_id: string } | undefined)?.mcp_credential_id;
}

export function revokeRuntimeCapability(runtimeId: string, now = new Date()): boolean {
  const changed = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const binding = db.prepare(
      "SELECT id, mcp_credential_id FROM runtime_capability_bindings WHERE runtime_id = ? AND revoked_at IS NULL",
    ).get(runtimeId) as { id: string; mcp_credential_id: string } | undefined;
    if (!binding) return false;
    const timestamp = now.toISOString();
    db.prepare("UPDATE mcp_credentials SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(timestamp, binding.mcp_credential_id);
    return db.prepare("UPDATE runtime_capability_bindings SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(timestamp, binding.id).changes === 1;
  });
  if (changed) checkpointAfterWrite();
  return changed;
}

export function issueRuntimeLaunchTicket(input: {
  runtimeId: string;
  ownerUserId: string;
  audience: RuntimeLaunchAudience;
  ttlMs?: number;
  now?: Date;
}): RuntimeLaunchTicket & { token: string } {
  const ttlMs = input.ttlMs ?? 60_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 60_000
    || !["web", "cli", "vscode"].includes(input.audience)) throw new Error("Invalid runtime launch ticket");
  const nonce = randomBytes(16).toString("base64url");
  const token = `rt_${nonce}_${randomBytes(32).toString("base64url")}`;
  const issued = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const runtime = db.prepare("SELECT * FROM runtime_instances WHERE id = ?").get(input.runtimeId) as RuntimeRow | undefined;
    if (!runtime || runtime.owner_user_id !== input.ownerUserId || (runtime.state !== "READY" && runtime.state !== "IDLE")) {
      throw new RuntimeConflictError("SCOPE_UNAVAILABLE");
    }
    const createdAt = (input.now ?? new Date()).toISOString();
    const id = randomUUID();
    db.prepare(`INSERT INTO runtime_launch_tickets
      (id, runtime_id, organization_id, project_id, owner_user_id, audience, token_hash, nonce_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, runtime.id, runtime.organization_id, runtime.project_id, runtime.owner_user_id, input.audience,
      sha256(token), sha256(nonce), new Date(new Date(createdAt).getTime() + ttlMs).toISOString(), createdAt,
    );
    return launchTicketDto(db.prepare("SELECT * FROM runtime_launch_tickets WHERE id = ?").get(id) as RuntimeLaunchTicketRow);
  });
  checkpointAfterWrite();
  return { ...issued, token };
}

export function consumeRuntimeLaunchTicket(input: {
  token: string;
  runtimeId: string;
  ownerUserId: string;
  audience: RuntimeLaunchAudience;
  now?: Date;
}): RuntimeLaunchTicket | undefined {
  const match = /^rt_([A-Za-z0-9_-]{22})_[A-Za-z0-9_-]{43}$/.exec(input.token);
  if (!match || !["web", "cli", "vscode"].includes(input.audience)) return undefined;
  const now = input.now ?? new Date();
  const consumed = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const row = db.prepare(`SELECT t.* FROM runtime_launch_tickets t
      JOIN runtime_instances r ON r.id = t.runtime_id
      JOIN authorized_workspaces w ON w.id = r.workspace_id
      WHERE t.token_hash = ? AND t.nonce_hash = ? AND t.runtime_id = ? AND t.owner_user_id = ?
        AND t.audience = ? AND t.consumed_at IS NULL AND t.expires_at > ?
        AND r.state IN ('READY', 'IDLE') AND r.organization_id = t.organization_id
        AND r.project_id = t.project_id AND r.owner_user_id = t.owner_user_id
        AND w.status = 'authorized' AND w.security_epoch = r.security_epoch`).get(
      sha256(input.token), sha256(match[1]!), input.runtimeId, input.ownerUserId, input.audience, now.toISOString(),
    ) as RuntimeLaunchTicketRow | undefined;
    if (!row) return undefined;
    const changed = db.prepare("UPDATE runtime_launch_tickets SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
      .run(now.toISOString(), row.id);
    return changed.changes === 1 ? launchTicketDto({ ...row, consumed_at: now.toISOString() }) : undefined;
  });
  if (consumed) checkpointAfterWrite();
  return consumed;
}

function browserSessionDto(row: RuntimeBrowserSessionRow): RuntimeBrowserSession {
  return {
    id: row.id,
    runtimeId: row.runtime_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    authSessionId: row.auth_session_id,
    audience: row.audience,
    origin: row.origin,
    host: row.host,
    generation: row.generation,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

export function issueRuntimeBrowserLaunchTicket(input: {
  runtimeId: string;
  ownerUserId: string;
  authSessionId: string;
  audience: RuntimeLaunchAudience;
  rootDomain: string;
  launcherOrigin: string;
  exchangeProof: string;
  ttlMs?: number;
  now?: Date;
}): { runtimeId: string; workspaceId: string; audience: RuntimeLaunchAudience; origin: string; host: string; launcherOrigin: string; expiresAt: string } {
  const ttlMs = input.ttlMs ?? 60_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 60_000
    || !/^[A-Za-z0-9_-]{43}$/.test(input.exchangeProof)) throw new Error("Invalid runtime browser launch ticket");
  const scope = runtimeAudienceOrigin(input.runtimeId, input.audience, input.rootDomain);
  const launcher = new URL(input.launcherOrigin);
  if (launcher.origin !== input.launcherOrigin || launcher.username || launcher.password
    || (launcher.protocol !== "https:" && !(launcher.protocol === "http:" && ["localhost", "127.0.0.1"].includes(launcher.hostname)))) {
    throw new Error("Invalid runtime launcher origin");
  }
  const issued = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const runtime = db.prepare(`SELECT r.*, g.generation FROM runtime_instances r
      JOIN runtime_browser_generations g ON g.runtime_id = r.id
      JOIN auth_sessions s ON s.id = ? AND s.user_id = r.owner_user_id AND s.revoked_at IS NULL
      WHERE r.id = ? AND r.owner_user_id = ? AND r.state IN ('READY', 'IDLE')`)
      .get(input.authSessionId, input.runtimeId, input.ownerUserId) as (RuntimeRow & { generation: number }) | undefined;
    if (!runtime) throw new RuntimeConflictError("SCOPE_UNAVAILABLE");
    const createdAt = input.now ?? new Date();
    const expiresAt = new Date(createdAt.getTime() + ttlMs).toISOString();
    db.prepare(`INSERT INTO runtime_browser_launch_tickets
      (id, runtime_id, workspace_id, organization_id, project_id, owner_user_id, auth_session_id, launcher_origin,
       audience, origin, host, token_hash, nonce_hash, generation, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), runtime.id, runtime.workspace_id, runtime.organization_id, runtime.project_id, runtime.owner_user_id,
      input.authSessionId, input.launcherOrigin, input.audience, scope.origin, scope.host,
      sha256(randomBytes(32).toString("base64url")), sha256(input.exchangeProof), runtime.generation,
      expiresAt, createdAt.toISOString(),
    );
    return { workspaceId: runtime.workspace_id, expiresAt };
  });
  checkpointAfterWrite();
  return { runtimeId: input.runtimeId, workspaceId: issued.workspaceId, audience: input.audience, ...scope, launcherOrigin: input.launcherOrigin, expiresAt: issued.expiresAt };
}

export function consumeRuntimeBrowserLaunchTicket(input: {
  exchangeProof: string;
  audience: RuntimeLaunchAudience;
  origin: string;
  host: string;
  launcherOrigin: string;
  now?: Date;
}): { session: RuntimeBrowserSession; token: string } | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.exchangeProof) || !["web", "cli", "vscode"].includes(input.audience)) return undefined;
  const now = input.now ?? new Date();
  const browserToken = `rbs_${randomBytes(32).toString("base64url")}`;
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const row = db.prepare(`SELECT t.* FROM runtime_browser_launch_tickets t
      JOIN runtime_instances r ON r.id = t.runtime_id
      JOIN authorized_workspaces w ON w.id = t.workspace_id
      JOIN auth_sessions a ON a.id = t.auth_session_id
      JOIN runtime_browser_generations g ON g.runtime_id = t.runtime_id
      WHERE t.nonce_hash = ? AND t.audience = ? AND t.origin = ? AND t.host = ? AND t.launcher_origin = ?
        AND t.consumed_at IS NULL AND t.expires_at > ? AND t.generation = g.generation
        AND r.state IN ('READY', 'IDLE') AND r.workspace_id = t.workspace_id
        AND r.organization_id = t.organization_id AND r.project_id = t.project_id AND r.owner_user_id = t.owner_user_id
        AND w.status = 'authorized' AND w.security_epoch = r.security_epoch
        AND a.user_id = t.owner_user_id AND a.revoked_at IS NULL
        AND a.idle_expires_at > ? AND a.absolute_expires_at > ?`).get(
      sha256(input.exchangeProof), input.audience, input.origin, input.host, input.launcherOrigin,
      now.toISOString(), now.toISOString(), now.toISOString(),
    ) as RuntimeBrowserTicketRow | undefined;
    if (!row || db.prepare("UPDATE runtime_browser_launch_tickets SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
      .run(now.toISOString(), row.id).changes !== 1) return undefined;
    const authExpiry = db.prepare("SELECT absolute_expires_at FROM auth_sessions WHERE id = ?")
      .get(row.auth_session_id) as { absolute_expires_at: string };
    const runtimeExpiry = db.prepare("SELECT absolute_expires_at FROM runtime_instances WHERE id = ?")
      .get(row.runtime_id) as { absolute_expires_at: string | null };
    const expiresAt = [authExpiry.absolute_expires_at, runtimeExpiry.absolute_expires_at]
      .filter((value): value is string => Boolean(value)).sort()[0]!;
    const id = randomUUID();
    db.prepare(`INSERT INTO runtime_browser_sessions
      (id, runtime_id, workspace_id, organization_id, project_id, owner_user_id, auth_session_id, audience,
       origin, host, token_hash, generation, expires_at, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, row.runtime_id, row.workspace_id, row.organization_id, row.project_id, row.owner_user_id,
      row.auth_session_id, row.audience, row.origin, row.host, sha256(browserToken), row.generation,
      expiresAt, now.toISOString(), now.toISOString(),
    );
    return browserSessionDto(db.prepare("SELECT * FROM runtime_browser_sessions WHERE id = ?").get(id) as RuntimeBrowserSessionRow);
  });
  if (!result) return undefined;
  checkpointAfterWrite();
  return { session: result, token: browserToken };
}

export function resolveRuntimeBrowserSession(input: {
  token: string;
  audience: RuntimeLaunchAudience;
  host: string;
  origin?: string;
  now?: Date;
  touch?: boolean;
}): { session: RuntimeBrowserSession; backendName: string } | undefined {
  if (!/^rbs_[A-Za-z0-9_-]{43}$/.test(input.token) || !["web", "cli", "vscode"].includes(input.audience)) return undefined;
  const now = input.now ?? new Date();
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
  const row = db.prepare(`SELECT s.*, r.backend_name FROM runtime_browser_sessions s
    JOIN runtime_instances r ON r.id = s.runtime_id
    JOIN authorized_workspaces w ON w.id = s.workspace_id
    JOIN auth_sessions a ON a.id = s.auth_session_id
    JOIN runtime_browser_generations g ON g.runtime_id = s.runtime_id
    WHERE s.token_hash = ? AND s.audience = ? AND s.host = ?
      AND (? IS NULL OR s.origin = ?) AND s.revoked_at IS NULL AND s.expires_at > ?
      AND s.generation = g.generation AND r.state IN ('READY', 'IDLE')
      AND r.workspace_id = s.workspace_id AND r.organization_id = s.organization_id
      AND r.project_id = s.project_id AND r.owner_user_id = s.owner_user_id
      AND w.status = 'authorized' AND w.security_epoch = r.security_epoch
      AND a.user_id = s.owner_user_id AND a.revoked_at IS NULL
      AND a.idle_expires_at > ? AND a.absolute_expires_at > ?`).get(
    sha256(input.token), input.audience, input.host, input.origin ?? null, input.origin ?? null,
    now.toISOString(), now.toISOString(), now.toISOString(),
  ) as (RuntimeBrowserSessionRow & { backend_name: string }) | undefined;
  if (!row) return undefined;
  if (input.touch) {
    execTransaction(() => db.prepare("UPDATE runtime_browser_sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(now.toISOString(), row.id));
    checkpointAfterWrite();
    row.last_seen_at = now.toISOString();
  }
  return { session: browserSessionDto(row), backendName: row.backend_name };
}

export function revokeRuntimeBrowserSessionsForUser(userId: string, now = new Date()): number {
  const changed = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const timestamp = now.toISOString();
    db.prepare(`UPDATE runtime_browser_generations SET generation = generation + 1, updated_at = ?
      WHERE runtime_id IN (SELECT id FROM runtime_instances WHERE owner_user_id = ?)`).run(timestamp, userId);
    db.prepare(`UPDATE runtime_browser_launch_tickets SET consumed_at = ?
      WHERE owner_user_id = ? AND consumed_at IS NULL`).run(timestamp, userId);
    const sessions = db.prepare("UPDATE runtime_browser_sessions SET revoked_at = ? WHERE owner_user_id = ? AND revoked_at IS NULL")
      .run(timestamp, userId).changes;
    db.prepare(`UPDATE runtime_instances SET active_connections = 0, active_generations = 0,
      revision = revision + 1, updated_at = ?
      WHERE owner_user_id = ? AND (active_connections > 0 OR active_generations > 0)`).run(timestamp, userId);
    return sessions;
  });
  checkpointAfterWrite();
  return changed;
}
