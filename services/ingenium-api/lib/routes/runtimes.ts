import { Router } from "express";
import { getDb, runtimes, securityAudit } from "ingenium-core";
import { z } from "zod";
import { inspectManagedRuntime, removeManagedRuntime, stopManagedRuntime } from "../runtime-manager-client.js";
import { deploymentMode } from "../runtime-mode.js";
import { ensureRuntime, runtimeNumberSetting } from "../runtime-provisioner.js";

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
  workspaceId: z.string().min(1).max(256),
}).strict();
const gatewayExchangeInput = z.object({
  exchangeProof: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  audience: z.enum(["web", "cli", "vscode"]),
  origin: z.string().url().max(512),
  host: z.string().min(1).max(253),
  launcherOrigin: z.string().url().max(512),
}).strict();
const gatewayValidateInput = gatewayExchangeInput.omit({ exchangeProof: true, launcherOrigin: true }).extend({ sessionToken: z.string().min(32).max(512) }).strict();
const gatewayActivityInput = gatewayValidateInput.extend({
  kind: z.enum(["connection_opened", "connection_closed", "generation_started", "generation_finished"]),
}).strict();

type BrowserWorkspaceRow = {
  id: string;
  organization_id: string;
  project_id: string;
  security_epoch: number;
  organization_name: string;
  project_name: string;
};

function browserWorkspaceRows(ownerUserId: string): BrowserWorkspaceRow[] {
  return getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(`SELECT w.id, w.organization_id, w.project_id, w.security_epoch,
      o.name AS organization_name, p.name AS project_name
    FROM authorized_workspaces w
    JOIN projects p ON p.id = w.project_id AND p.organization_id = w.organization_id AND p.archived_at IS NULL
    JOIN organizations o ON o.id = w.organization_id AND o.status = 'active'
    JOIN organization_memberships om ON om.organization_id = w.organization_id
      AND om.user_id = ? AND om.status = 'active'
    LEFT JOIN project_memberships pm ON pm.project_id = w.project_id AND pm.user_id = ?
    WHERE w.owner_user_id = ? AND w.status = 'authorized'
      AND (om.role IN ('owner', 'admin') OR pm.user_id IS NOT NULL)
    ORDER BY o.name, p.name, w.created_at, w.id`).all(ownerUserId, ownerUserId, ownerUserId) as BrowserWorkspaceRow[];
}

function browserWorkspace(ownerUserId: string, workspaceId: string): BrowserWorkspaceRow | undefined {
  return browserWorkspaceRows(ownerUserId).find((workspace) => workspace.id === workspaceId);
}

function browserWorkspaceStatus(workspace: BrowserWorkspaceRow): "ready" | "starting" | "stopped" | "unavailable" {
  const runtime = runtimes.getRuntimeForWorkspace(workspace.id);
  if (!runtime) return "stopped";
  if (runtime.securityEpoch !== workspace.security_epoch || runtime.state === "REVOKED") return "unavailable";
  if (runtime.state === "READY" || runtime.state === "IDLE") return "ready";
  if (["PROVISIONING", "STARTING", "STOPPING"].includes(runtime.state)) return "starting";
  return "stopped";
}

function browserWorkspaceDto(workspace: BrowserWorkspaceRow) {
  return {
    id: workspace.id,
    organizationName: workspace.organization_name,
    projectName: workspace.project_name,
    status: browserWorkspaceStatus(workspace),
  };
}

function browserRuntimeAudit(principalId: string, action: string, outcome: "success" | "denied" | "failure", workspace?: BrowserWorkspaceRow): void {
  securityAudit.appendSecurityAuditEvent({
    actorType: "user",
    actorId: principalId,
    action,
    organizationId: workspace?.organization_id,
    projectId: workspace?.project_id,
    outcome,
  });
}

function rejectBrowserInstallationRoute(req: import("express").Request, res: import("express").Response): boolean {
  if (req.principal?.type !== "user" || !req.principal.session) return false;
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
  return true;
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
    res.set("Cache-Control", "no-store");
    if (deploymentMode() === "compatibility") {
      res.json({ data: { mode: "compatibility", status: "ready", reason: null } });
      return;
    }
    if (deploymentMode() !== "control-plane") {
      res.json({ data: { mode: "isolated", status: "unavailable", reason: "runtime_unavailable" } });
      return;
    }
    const workspaces = browserWorkspaceRows(principal.id);
    const statuses = workspaces.map(browserWorkspaceStatus);
    const status = statuses.includes("ready") ? "ready"
      : statuses.includes("starting") ? "starting" : "no_runtime";
    const reason = status === "ready" ? null
      : status === "starting" ? "runtime_starting"
      : workspaces.length === 0 ? "no_authorized_workspace" : "explicit_start_required";
    res.json({ data: { mode: "isolated", status, reason } });
  } catch (error) {
    runtimeError(res, error);
  }
});

runtimesRouter.get("/browser/workspaces", (req, res) => {
  try {
    const principal = browserPrincipal(req);
    res.set("Cache-Control", "no-store");
    res.json({ data: deploymentMode() === "control-plane" ? browserWorkspaceRows(principal.id).map(browserWorkspaceDto) : [] });
  } catch (error) {
    runtimeError(res, error);
  }
});

runtimesRouter.post("/browser/workspaces/:workspaceId/start", async (req, res) => {
  try {
    const principal = browserPrincipal(req);
    if (deploymentMode() !== "control-plane") throw new runtimes.RuntimeConflictError("STATE_CONFLICT");
    const workspace = browserWorkspace(principal.id, req.params.workspaceId!);
    if (!workspace) {
      browserRuntimeAudit(principal.id, "runtime.workspace.start", "denied");
      throw new runtimes.RuntimeConflictError("SCOPE_UNAVAILABLE");
    }
    let runtime: runtimes.RuntimeInstance;
    try {
      runtime = await ensureRuntime(workspace.id);
    } catch (error) {
      browserRuntimeAudit(principal.id, "runtime.workspace.start", "failure", workspace);
      throw error;
    }
    const status = runtime.state === "READY" || runtime.state === "IDLE" ? "ready" : "starting";
    browserRuntimeAudit(principal.id, "runtime.workspace.start", "success", workspace);
    res.set("Cache-Control", "no-store");
    res.status(status === "ready" ? 200 : 202).json({ data: { status } });
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
    if (deploymentMode() !== "control-plane") throw new runtimes.RuntimeConflictError("STATE_CONFLICT");
    const workspace = browserWorkspace(principal.id, parsed.data.workspaceId);
    const runtime = workspace ? runtimes.getRuntimeForWorkspace(workspace.id) : undefined;
    if (!workspace || !runtime || runtime.securityEpoch !== workspace.security_epoch
      || (runtime.state !== "READY" && runtime.state !== "IDLE")) throw new runtimes.RuntimeConflictError("SCOPE_UNAVAILABLE");
    const ticket = runtimes.issueRuntimeBrowserLaunchTicket({
      audience: parsed.data.audience,
      exchangeProof: parsed.data.exchangeProof,
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

runtimesRouter.post("/gateway/activity", (req, res) => {
  const parsed = gatewayActivityInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Runtime activity request is invalid" } });
    return;
  }
  const resolved = runtimes.resolveRuntimeBrowserSession({
    token: parsed.data.sessionToken,
    audience: parsed.data.audience,
    host: parsed.data.host,
    origin: parsed.data.origin,
    touch: true,
  });
  const runtime = resolved ? runtimes.getRuntimeInstance(resolved.session.runtimeId) : undefined;
  if (!resolved || !runtime) {
    res.status(401).json({ error: { code: "INVALID_RUNTIME_SESSION", message: "Runtime browser session is invalid" } });
    return;
  }
  try {
    runtimes.recordRuntimeActivity({
      id: runtime.id,
      expectedRevision: runtime.revision,
      kind: parsed.data.kind,
      actorId: resolved.session.ownerUserId,
      idleLeaseMs: runtimeNumberSetting("INGENIUM_RUNTIME_IDLE_LEASE_MS", 1_800_000, 60_000),
    });
    res.set("Cache-Control", "no-store");
    res.json({ data: { accepted: true } });
  } catch (error) {
    runtimeError(res, error);
  }
});

runtimesRouter.get("/", (req, res) => {
  if (rejectBrowserInstallationRoute(req, res)) return;
  res.json({ data: runtimes.listRuntimeInstances() });
});

runtimesRouter.get("/workspaces", (req, res) => {
  if (rejectBrowserInstallationRoute(req, res)) return;
  res.json({ data: runtimes.listAuthorizedWorkspaces() });
});

runtimesRouter.post("/workspaces", (req, res) => {
  if (rejectBrowserInstallationRoute(req, res)) return;
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
  if (rejectBrowserInstallationRoute(req, res)) return;
  const parsed = runtimeInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "workspaceId is required" } });
    return;
  }
  try {
    const runtime = await ensureRuntime(parsed.data.workspaceId);
    res.status(202).json({ data: runtime });
  } catch (error) {
    runtimeError(res, error);
  }
});

runtimesRouter.get("/:id", async (req, res) => {
  if (rejectBrowserInstallationRoute(req, res)) return;
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
  if (rejectBrowserInstallationRoute(req, res)) return;
  const runtime = runtimes.getRuntimeInstance(req.params.id!);
  if (!runtime) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Runtime not found" } });
    return;
  }
  try { res.json({ data: await stopRuntime(runtime) }); } catch (error) { runtimeError(res, error); }
});

runtimesRouter.post("/:id/revoke", async (req, res) => {
  if (rejectBrowserInstallationRoute(req, res)) return;
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
