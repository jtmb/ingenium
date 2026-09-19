import { createHash, randomBytes } from "node:crypto";
import { getDb, mcpCredentials, runtimes } from "ingenium-core";
import { provisionManagedRuntime, removeManagedRuntime } from "./runtime-manager-client.js";
import { deploymentMode } from "./runtime-mode.js";

export const LOCAL_RUNTIME_SCOPES = [
  "child-mcp:runtime", "child-mcp:execute", "mcp-servers:write",
  "projects:read", "documentation:read", "rag:read", "memory:write",
].sort();

export function provisionLocalRuntime(workspaceId: string) {
  let stage = "mode";
  try {
    if (deploymentMode() !== "compatibility" || process.env.INGENIUM_RUNTIME_MANAGER_URL?.trim()) {
      throw new runtimes.RuntimeConflictError("SCOPE_UNAVAILABLE");
    }
    stage = "workspace";
    const workspace = runtimes.getAuthorizedWorkspace(workspaceId);
    if (!workspace || workspace.status !== "authorized") throw new runtimes.RuntimeConflictError("SCOPE_UNAVAILABLE");
    stage = "instance";
    let runtime = getOrCreateRuntime(workspace);
    stage = "lifecycle";
    if (runtime.securityEpoch !== workspace.securityEpoch || runtime.backendContainerId !== null
      || !["ABSENT", "FAILED", "STOPPED", "PROVISIONING", "STARTING", "READY", "IDLE"].includes(runtime.state)) {
      throw new runtimes.RuntimeConflictError("SCOPE_UNAVAILABLE");
    }
    for (const [from, toState] of [
      ["FAILED", "PROVISIONING"], ["STOPPED", "PROVISIONING"], ["ABSENT", "PROVISIONING"],
      ["PROVISIONING", "STARTING"], ["STARTING", "READY"], ["IDLE", "READY"],
    ] as const) {
      if (runtime.state === from) runtime = runtimes.transitionRuntime({
        id: runtime.id, expectedRevision: runtime.revision, toState,
        actorType: "system", actorId: "compatibility-provisioner", backendContainerId: null,
      });
    }
    const name = `Runtime ${runtime.id}`;
    stage = "credential";
    const profile = createHash("sha256").update(JSON.stringify(LOCAL_RUNTIME_SCOPES)).digest("hex");
    const credential = mcpCredentials.createMcpCredential({
      servicePrincipalId: runtimeServicePrincipalId(runtime, name), servicePrincipalName: name,
      kind: "runtime", audience: "runtime", name, scopes: [...LOCAL_RUNTIME_SCOPES],
      organizationId: runtime.organizationId, projectId: runtime.projectId, workspaceId: runtime.workspaceId,
      // Credential storage binding stays canonical; runtime HTTP attestation uses /workspace.
      launcherWorktree: workspace.storagePath, createdByUserId: runtime.ownerUserId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    }, `compatibility-runtime:${runtime.id}:${runtime.securityEpoch}:${profile}`);
    stage = "binding";
    const bound = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT mcp_credential_id FROM runtime_capability_bindings WHERE runtime_id = ? AND revoked_at IS NULL",
    ).get(runtime.id) as { mcp_credential_id: string } | undefined;
    // Rebinding the same credential would revoke it; receipt replay must not mutate the binding.
    if (bound?.mcp_credential_id !== credential.id) runtimes.bindRuntimeCapability(runtime.id, credential.id);
    stage = "resolution";
    if (!mcpCredentials.resolveMcpCredential(credential.token, "runtime")) throw new runtimes.RuntimeConflictError("SCOPE_UNAVAILABLE");
    const now = Date.now();
    if (runtime.absoluteExpiresAt === null || Date.parse(runtime.absoluteExpiresAt) <= now) {
      stage = "lifetime";
      const absoluteLeaseMs = runtimeNumberSetting("INGENIUM_RUNTIME_ABSOLUTE_LEASE_MS", 28_800_000, 60_000);
      const idleLeaseMs = runtimeNumberSetting("INGENIUM_RUNTIME_IDLE_LEASE_MS", 1_800_000, 60_000);
      // Receipt replay must never extend the existing capability's lifetime.
      const expiresAt = Math.min(now + absoluteLeaseMs, Date.parse(credential.expiresAt));
      runtime = runtimes.renewLocalRuntimeLifetime({
        id: runtime.id, expectedRevision: runtime.revision,
        absoluteExpiresAt: new Date(expiresAt),
        idleExpiresAt: new Date(Math.min(now + idleLeaseMs, expiresAt)),
      });
    }
    return { runtime, credential };
  } catch (error) {
    throw new LocalRuntimeProvisionError(stage, error instanceof runtimes.RuntimeConflictError ? error.code
      : error instanceof Error && error.message === "Credential replay is unavailable" ? "CREDENTIAL_REPLAY_UNAVAILABLE"
      : "PREREQUISITE_FAILED");
  }
}

export class LocalRuntimeProvisionError extends Error {
  constructor(readonly stage: string, readonly code: string) {
    super("Local runtime provisioning failed");
  }
}

const inFlight = new Map<string, Promise<runtimes.RuntimeInstance>>();

export function runtimeNumberSetting(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`${name} is invalid`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${name} is invalid`);
  return parsed;
}

function defaultLimits(): runtimes.RuntimeLimits {
  return {
    cpuMillis: runtimeNumberSetting("INGENIUM_RUNTIME_CPU_MILLIS", 1_000, 100),
    memoryBytes: runtimeNumberSetting("INGENIUM_RUNTIME_MEMORY_BYTES", 1_073_741_824, 134_217_728),
    pidsLimit: runtimeNumberSetting("INGENIUM_RUNTIME_PIDS_LIMIT", 256, 16),
    diskBytes: runtimeNumberSetting("INGENIUM_RUNTIME_DISK_BYTES", 2_147_483_648, 67_108_864),
    processLimit: runtimeNumberSetting("INGENIUM_RUNTIME_PROCESS_LIMIT", 128, 16),
  };
}

function projectName(projectId: string): string | undefined {
  return (getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT name FROM projects WHERE id = ? AND archived_at IS NULL",
  ).get(projectId) as { name: string } | undefined)?.name;
}

function runtimeServicePrincipalId(runtime: runtimes.RuntimeInstance, name: string): string | undefined {
  return (getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(`SELECT principal.id FROM automation_principal_grants grant_row
    JOIN service_principals principal ON principal.id = grant_row.service_principal_id
    WHERE grant_row.organization_id = ? AND grant_row.project_id = ?
      AND grant_row.permission = 'execute' AND grant_row.status = 'active'
      AND principal.organization_id = ? AND principal.security_epoch = ? AND principal.status = 'active'
    ORDER BY grant_row.created_at, grant_row.id LIMIT 1`)
    .get(runtime.organizationId, runtime.projectId, runtime.organizationId, runtime.securityEpoch) as { id: string } | undefined)?.id
    ?? (getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(`SELECT sp.id FROM runtime_capability_bindings b
    JOIN mcp_credentials c ON c.id = b.mcp_credential_id
    JOIN service_principals sp ON sp.id = c.service_principal_id
    WHERE b.runtime_id = ? AND sp.organization_id = ? AND sp.security_epoch = ? AND sp.status = 'active'
    ORDER BY b.created_at DESC LIMIT 1`).get(runtime.id, runtime.organizationId, runtime.securityEpoch) as { id: string } | undefined)?.id
    ?? (getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT id FROM service_principals WHERE organization_id = ? AND name = ? AND security_epoch = ? AND status = 'active'",
    ).get(runtime.organizationId, name, runtime.securityEpoch) as { id: string } | undefined)?.id;
}

function getOrCreateRuntime(workspace: runtimes.AuthorizedWorkspace): runtimes.RuntimeInstance {
  const existing = runtimes.getRuntimeForWorkspace(workspace.id);
  if (existing) return existing;
  try {
    return runtimes.createRuntimeInstance(workspace.id, defaultLimits());
  } catch (error) {
    const concurrent = runtimes.getRuntimeForWorkspace(workspace.id);
    if (concurrent) return concurrent;
    throw error;
  }
}

async function provision(workspaceId: string): Promise<runtimes.RuntimeInstance> {
  const workspace = runtimes.getAuthorizedWorkspace(workspaceId);
  if (!workspace || workspace.status !== "authorized") throw new runtimes.RuntimeConflictError("SCOPE_UNAVAILABLE");
  let runtime = getOrCreateRuntime(workspace);
  if (runtime.securityEpoch !== workspace.securityEpoch || runtime.state === "REVOKED") {
    throw new runtimes.RuntimeConflictError("SCOPE_UNAVAILABLE");
  }
  if (["PROVISIONING", "STARTING", "READY", "IDLE", "STOPPING"].includes(runtime.state)) return runtime;

  let capabilityBound = false;
  try {
    const project = projectName(runtime.projectId);
    if (!project) throw new runtimes.RuntimeConflictError("SCOPE_UNAVAILABLE");
    const absoluteLeaseMs = runtimeNumberSetting("INGENIUM_RUNTIME_ABSOLUTE_LEASE_MS", 28_800_000, 60_000);
    const idleLeaseMs = runtimeNumberSetting("INGENIUM_RUNTIME_IDLE_LEASE_MS", 1_800_000, 60_000);
    const expiresAt = new Date(Date.now() + absoluteLeaseMs);
    const principalName = `Runtime ${runtime.id}`;
    const credential = mcpCredentials.createMcpCredential({
      servicePrincipalId: runtimeServicePrincipalId(runtime, principalName),
      servicePrincipalName: principalName,
      kind: "runtime",
      audience: "runtime",
      name: principalName,
       scopes: ["child-mcp:execute", "child-mcp:runtime", "memory:read", "projects:read", "runtime:activity"],
      organizationId: runtime.organizationId,
      projectId: runtime.projectId,
      workspaceId: runtime.workspaceId,
      launcherWorktree: workspace.storagePath,
      expiresAt,
      createdByUserId: runtime.ownerUserId,
    });
    runtimes.bindRuntimeCapability(runtime.id, credential.id);
    capabilityBound = true;
    runtime = runtimes.transitionRuntime({
      id: runtime.id,
      expectedRevision: runtime.revision,
      toState: "PROVISIONING",
      actorType: "manager",
      actorId: "runtime-manager",
      backendContainerId: null,
      maxActiveRuntimes: runtimeNumberSetting("INGENIUM_RUNTIME_MAX_ACTIVE_PER_USER", 2, 1),
      idleExpiresAt: new Date(Date.now() + idleLeaseMs),
      absoluteExpiresAt: expiresAt,
    });
    runtime = runtimes.claimRuntimeLease({
      id: runtime.id,
      expectedRevision: runtime.revision,
      ownerToken: randomBytes(32).toString("base64url"),
      ttlMs: 60_000,
      actorId: "runtime-manager",
    });
    const managed = await provisionManagedRuntime({
      runtime,
      projectName: project,
      storagePath: workspace.storagePath,
      storageMappingHash: workspace.storageMappingHash,
      capability: credential.token,
      capabilityExpiresAt: credential.expiresAt,
    });
    return runtimes.transitionRuntime({
      id: runtime.id,
      expectedRevision: runtime.revision,
      toState: "STARTING",
      actorType: "manager",
      actorId: "runtime-manager",
      backendContainerId: managed.backendId ?? null,
    });
  } catch (error) {
    if (capabilityBound) runtimes.revokeRuntimeCapability(runtime.id);
    const current = runtimes.getRuntimeInstance(runtime.id);
    if (current?.state === "PROVISIONING") {
      await removeManagedRuntime(current.id).catch(() => undefined);
      try {
        runtimes.transitionRuntime({
          id: current.id,
          expectedRevision: current.revision,
          toState: "FAILED",
          actorType: "system",
          actorId: "runtime-provisioner",
        });
      } catch { /* A reconciler already owns the current revision. */ }
    }
    throw error;
  }
}

export function ensureRuntime(workspaceId: string): Promise<runtimes.RuntimeInstance> {
  const current = inFlight.get(workspaceId);
  if (current) return current;
  const started = provision(workspaceId).finally(() => {
    if (inFlight.get(workspaceId) === started) inFlight.delete(workspaceId);
  });
  inFlight.set(workspaceId, started);
  return started;
}
