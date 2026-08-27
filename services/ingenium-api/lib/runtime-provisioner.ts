import { randomBytes } from "node:crypto";
import { getDb, mcpCredentials, runtimes } from "ingenium-core";
import { provisionManagedRuntime, removeManagedRuntime } from "./runtime-manager-client.js";

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
      scopes: ["child-mcp:runtime", "coordination:read", "coordination:write", "projects:read", "runtime:activity"],
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
