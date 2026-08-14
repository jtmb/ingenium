import { randomBytes } from "node:crypto";
import { Router } from "express";
import { getDb, mcpCredentials, runtimes } from "ingenium-core";
import { z } from "zod";
import { inspectManagedRuntime, provisionManagedRuntime, removeManagedRuntime, stopManagedRuntime } from "../runtime-manager-client.js";

export const runtimesRouter = Router();

const workspaceInput = z.object({
  id: z.string().min(1).max(256),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  storagePath: z.string().min(1).max(1024),
}).strict();
const runtimeInput = z.object({ workspaceId: z.string().min(1).max(256) }).strict();
const browserLaunchInput = z.object({
  audience: z.enum(["web", "cli", "vscode"]),
  exchangeProof: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
const gatewayExchangeInput = z.object({
  exchangeProof: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  audience: z.enum(["web", "cli", "vscode"]),
  origin: z.string().url().max(512),
  host: z.string().min(1).max(253),
  launcherOrigin: z.string().url().max(512),
}).strict();
const gatewayValidateInput = gatewayExchangeInput.omit({ exchangeProof: true, launcherOrigin: true }).extend({ sessionToken: z.string().min(32).max(512) }).strict();

function numberSetting(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`${name} is invalid`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${name} is invalid`);
  return parsed;
}

function defaultLimits(): runtimes.RuntimeLimits {
  return {
    cpuMillis: numberSetting("INGENIUM_RUNTIME_CPU_MILLIS", 1_000, 100),
    memoryBytes: numberSetting("INGENIUM_RUNTIME_MEMORY_BYTES", 1_073_741_824, 134_217_728),
    pidsLimit: numberSetting("INGENIUM_RUNTIME_PIDS_LIMIT", 256, 16),
    diskBytes: numberSetting("INGENIUM_RUNTIME_DISK_BYTES", 2_147_483_648, 67_108_864),
    processLimit: numberSetting("INGENIUM_RUNTIME_PROCESS_LIMIT", 128, 16),
  };
}

function projectName(projectId: string): string | undefined {
  return (getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT name FROM projects WHERE id = ? AND archived_at IS NULL",
  ).get(projectId) as { name: string } | undefined)?.name;
}

function runtimeServicePrincipalId(runtime: runtimes.RuntimeInstance, name: string): string | undefined {
  return (getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(`SELECT sp.id FROM runtime_capability_bindings b
    JOIN mcp_credentials c ON c.id = b.mcp_credential_id
    JOIN service_principals sp ON sp.id = c.service_principal_id
    WHERE b.runtime_id = ? AND sp.organization_id = ? AND sp.security_epoch = ? AND sp.status = 'active'
    ORDER BY b.created_at DESC LIMIT 1`).get(runtime.id, runtime.organizationId, runtime.securityEpoch) as { id: string } | undefined)?.id
    ?? (getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT id FROM service_principals WHERE organization_id = ? AND name = ? AND security_epoch = ? AND status = 'active'",
    ).get(runtime.organizationId, name, runtime.securityEpoch) as { id: string } | undefined)?.id;
}

function runtimeError(res: import("express").Response, error: unknown): void {
  if (error instanceof runtimes.RuntimeConflictError) {
    const status = error.code === "SCOPE_UNAVAILABLE" ? 404 : error.code === "QUOTA_EXCEEDED" ? 429 : 409;
    res.status(status).json({ error: { code: error.code, message: "Runtime request rejected" } });
    return;
  }
  res.status(503).json({ error: { code: "RUNTIME_UNAVAILABLE", message: "Runtime service is unavailable" } });
}

function browserPrincipal(req: import("express").Request): { id: string; sessionId: string } {
  if (req.principal?.type !== "user" || !req.principal.session) throw new runtimes.RuntimeConflictError("SCOPE_UNAVAILABLE");
  return { id: req.principal.id, sessionId: req.principal.session.id };
}

function runtimeRootDomain(): string {
  const value = process.env.INGENIUM_RUNTIME_ROOT_DOMAIN?.trim();
  if (!value) throw new Error("Runtime browser roots are not configured");
  return value;
}

runtimesRouter.get("/browser/status", (req, res) => {
  try {
    const principal = browserPrincipal(req);
    const owned = runtimes.listRuntimeInstances(principal.id);
    const status = owned.some((runtime) => runtime.state === "READY" || runtime.state === "IDLE")
      ? "ready"
      : owned.some((runtime) => runtime.state === "PROVISIONING" || runtime.state === "STARTING") ? "starting" : "unavailable";
    res.set("Cache-Control", "no-store");
    res.json({ data: { status } });
  } catch (error) {
    runtimeError(res, error);
  }
});

runtimesRouter.post("/browser/launch", (req, res) => {
  const parsed = browserLaunchInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Runtime launch request is invalid" } });
    return;
  }
  try {
    const principal = browserPrincipal(req);
    const runtime = runtimes.listRuntimeInstances(principal.id)
      .find((candidate) => candidate.state === "READY" || candidate.state === "IDLE");
    if (!runtime) throw new runtimes.RuntimeConflictError("SCOPE_UNAVAILABLE");
    const ticket = runtimes.issueRuntimeBrowserLaunchTicket({
      ...parsed.data,
      runtimeId: runtime.id,
      ownerUserId: principal.id,
      authSessionId: principal.sessionId,
      rootDomain: runtimeRootDomain(),
      launcherOrigin: req.get("origin") ?? "",
    });
    res.set("Cache-Control", "no-store");
    res.status(201).json({ data: { launchUrl: `${ticket.origin}/__ingenium/exchange`, status: "ready" } });
  } catch (error) {
    runtimeError(res, error);
  }
});

runtimesRouter.post("/gateway/exchange", (req, res) => {
  const parsed = gatewayExchangeInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Runtime exchange request is invalid" } });
    return;
  }
  const exchanged = runtimes.consumeRuntimeBrowserLaunchTicket(parsed.data);
  if (!exchanged) {
    res.status(401).json({ error: { code: "INVALID_LAUNCH_TICKET", message: "Runtime launch ticket is invalid or expired" } });
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json({ data: { sessionToken: exchanged.token, session: exchanged.session } });
});

runtimesRouter.post("/gateway/validate", (req, res) => {
  const parsed = gatewayValidateInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Runtime session request is invalid" } });
    return;
  }
  const resolved = runtimes.resolveRuntimeBrowserSession({
    token: parsed.data.sessionToken,
    audience: parsed.data.audience,
    host: parsed.data.host,
    origin: parsed.data.origin,
    touch: true,
  });
  if (!resolved) {
    res.status(401).json({ error: { code: "INVALID_RUNTIME_SESSION", message: "Runtime browser session is invalid" } });
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json({ data: { backendName: resolved.backendName, session: resolved.session } });
});

runtimesRouter.get("/", (_req, res) => {
  res.json({ data: runtimes.listRuntimeInstances() });
});

runtimesRouter.get("/workspaces", (_req, res) => {
  res.json({ data: runtimes.listAuthorizedWorkspaces() });
});

runtimesRouter.post("/workspaces", (req, res) => {
  const parsed = workspaceInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Workspace authorization is invalid" } });
    return;
  }
  const byId = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT id, organization_id FROM projects WHERE id = ? AND archived_at IS NULL",
  ).get(parsed.data.projectId) as { id: string; organization_id: string } | undefined;
  if (!byId || byId.organization_id !== parsed.data.organizationId) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
    return;
  }
  try {
    res.status(201).json({ data: runtimes.authorizeWorkspace(parsed.data) });
  } catch (error) {
    runtimeError(res, error);
  }
});

runtimesRouter.post("/", async (req, res) => {
  const parsed = runtimeInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "workspaceId is required" } });
    return;
  }
  let runtime: runtimes.RuntimeInstance | undefined;
  let capabilityBound = false;
  try {
    const workspace = runtimes.getAuthorizedWorkspace(parsed.data.workspaceId);
    if (!workspace || workspace.status !== "authorized") throw new runtimes.RuntimeConflictError("SCOPE_UNAVAILABLE");
    runtime = runtimes.getRuntimeForWorkspace(workspace.id) ?? runtimes.createRuntimeInstance(workspace.id, defaultLimits());
    if (runtime.state !== "ABSENT" && runtime.state !== "STOPPED" && runtime.state !== "FAILED") {
      res.status(409).json({ error: { code: "STATE_CONFLICT", message: "Runtime is already active" } });
      return;
    }
    const project = projectName(runtime.projectId);
    if (!project) throw new runtimes.RuntimeConflictError("SCOPE_UNAVAILABLE");
    const absoluteLeaseMs = numberSetting("INGENIUM_RUNTIME_ABSOLUTE_LEASE_MS", 28_800_000, 60_000);
    const idleLeaseMs = numberSetting("INGENIUM_RUNTIME_IDLE_LEASE_MS", 1_800_000, 60_000);
    const expiresAt = new Date(Date.now() + absoluteLeaseMs);
    const principalName = `Runtime ${runtime.id}`;
    const credential = mcpCredentials.createMcpCredential({
      servicePrincipalId: runtimeServicePrincipalId(runtime, principalName),
      servicePrincipalName: principalName,
      kind: "runtime",
      audience: "runtime",
      name: `Runtime ${runtime.id}`,
      scopes: ["child-mcp:runtime", "projects:read"],
      organizationId: runtime.organizationId,
      projectId: runtime.projectId,
      workspaceId: runtime.workspaceId,
      launcherWorktree: workspace.storagePath,
      expiresAt,
      createdByUserId: runtime.ownerUserId,
    });
    runtimes.bindRuntimeCapability(runtime.id, credential.id);
    capabilityBound = true;
    runtime = runtimes.claimRuntimeLease({
      id: runtime.id,
      expectedRevision: runtime.revision,
      ownerToken: randomBytes(32).toString("base64url"),
      ttlMs: 60_000,
      actorId: "runtime-manager",
    });
    runtime = runtimes.transitionRuntime({
      id: runtime.id,
      expectedRevision: runtime.revision,
      toState: "PROVISIONING",
      actorType: "manager",
      actorId: "runtime-manager",
      backendContainerId: null,
      maxActiveRuntimes: numberSetting("INGENIUM_RUNTIME_MAX_ACTIVE_PER_USER", 2, 1),
      idleExpiresAt: new Date(Date.now() + idleLeaseMs),
      absoluteExpiresAt: expiresAt,
    });
    const managed = await provisionManagedRuntime({
      runtime,
      projectName: project,
      storagePath: workspace.storagePath,
      storageMappingHash: workspace.storageMappingHash,
      capability: credential.token,
      capabilityExpiresAt: credential.expiresAt,
    });
    runtime = runtimes.transitionRuntime({
      id: runtime.id,
      expectedRevision: runtime.revision,
      toState: "STARTING",
      actorType: "manager",
      actorId: "runtime-manager",
      backendContainerId: managed.backendId ?? null,
    });
    res.status(202).json({ data: runtime });
  } catch (error) {
    if (runtime && capabilityBound) runtimes.revokeRuntimeCapability(runtime.id);
    if (runtime && runtime.state === "PROVISIONING") {
      await removeManagedRuntime(runtime.id).catch(() => undefined);
      try {
        runtime = runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "FAILED", actorType: "system", actorId: "runtime-provisioner" });
      } catch { /* A concurrent reconciler owns the current revision. */ }
    }
    runtimeError(res, error);
  }
});

runtimesRouter.get("/:id", async (req, res) => {
  const runtime = runtimes.getRuntimeInstance(req.params.id!);
  if (!runtime) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Runtime not found" } });
    return;
  }
  try {
    res.json({ data: { runtime, backend: await inspectManagedRuntime(runtime.id) } });
  } catch (error) {
    runtimeError(res, error);
  }
});

async function stopRuntime(runtime: runtimes.RuntimeInstance): Promise<runtimes.RuntimeInstance> {
  let current = runtime;
  if (current.state !== "STOPPING" && current.state !== "STOPPED" && current.state !== "ABSENT" && current.state !== "REVOKED") {
    current = runtimes.transitionRuntime({ id: current.id, expectedRevision: current.revision, toState: "STOPPING", actorType: "manager", actorId: "runtime-manager" });
  }
  if (current.state === "STOPPING") {
    await stopManagedRuntime(current.id);
    current = runtimes.transitionRuntime({ id: current.id, expectedRevision: current.revision, toState: "STOPPED", actorType: "manager", actorId: "runtime-manager" });
  }
  return current;
}

runtimesRouter.post("/:id/stop", async (req, res) => {
  const runtime = runtimes.getRuntimeInstance(req.params.id!);
  if (!runtime) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Runtime not found" } });
    return;
  }
  try { res.json({ data: await stopRuntime(runtime) }); } catch (error) { runtimeError(res, error); }
});

runtimesRouter.post("/:id/revoke", async (req, res) => {
  const runtime = runtimes.getRuntimeInstance(req.params.id!);
  if (!runtime) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Runtime not found" } });
    return;
  }
  try {
    let current = runtime;
    if (current.state === "REVOKED") {
      await removeManagedRuntime(current.id);
      res.json({ data: current });
      return;
    }
    if (current.state !== "STOPPED" && current.state !== "ABSENT") {
      if (current.state !== "STOPPING") current = runtimes.transitionRuntime({ id: current.id, expectedRevision: current.revision, toState: "STOPPING", actorType: "manager", actorId: "runtime-manager" });
      await removeManagedRuntime(current.id);
      current = runtimes.transitionRuntime({ id: current.id, expectedRevision: current.revision, toState: "STOPPED", actorType: "manager", actorId: "runtime-manager" });
    } else {
      await removeManagedRuntime(current.id);
    }
    runtimes.revokeRuntimeCapability(current.id);
    current = runtimes.transitionRuntime({ id: current.id, expectedRevision: current.revision, toState: "REVOKED", actorType: "manager", actorId: "runtime-manager" });
    res.json({ data: current });
  } catch (error) {
    runtimeError(res, error);
  }
});
