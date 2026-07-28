import { Router, type Request, type Response } from "express";
import { childMcpServers, vault } from "ingenium-core";
import { requireProject } from "../helpers.js";

/**
 * Canonical child-MCP definition API.
 *
 * This router stores validated definitions and discovery metadata only. It does
 * not launch a child process, connect to one, or forward any MCP tool calls.
 */
export const mcpServersRouter = Router();

/**
 * This handoff intentionally lives outside `/api/v1`: dashboard rewrites only
 * proxy that public namespace. The MCP stdio process uses this path to receive
 * already-resolved environment values immediately before it launches a child.
 */
export const CHILD_MCP_RUNTIME_HANDOFF_PATH = "/_ingenium/child-mcp-runtime";
export const CHILD_MCP_RUNTIME_HANDOFF_HEADER = "x-ingenium-child-mcp-runtime";
const CHILD_MCP_RUNTIME_HANDOFF_VALUE = "1";

/** Router mounted only on the server-to-server runtime handoff path. */
export const childMcpRuntimeRouter = Router();

/**
 * Resolve vault references only for the authenticated MCP runtime handoff.
 * This route is intentionally separate from ordinary definition/status reads:
 * no other child-MCP response contains a plaintext environment value.
 */
function trustedRuntimeDefinitions(projectId: string) {
  const unavailable: Array<{ name: string; diagnostic: "unavailable" }> = [];
  const data = [] as Array<{
    name: string;
    executable: string;
    args: string[];
    scope: "project" | "global";
    owned: boolean;
    revision: string;
    environment: Record<string, string>;
  }>;

  for (const definition of childMcpServers.listEffectiveChildMcpRuntimeServers(projectId)) {
    const environment: Record<string, string> = {};
    let resolved = true;
    for (const [key, reference] of Object.entries(definition.environment) as Array<[string, { vault_item_id: string }]>) {
      const value = vault.decryptItem(definition.owner_project_id, reference.vault_item_id);
      if (value === null) {
        resolved = false;
        break;
      }
      environment[key] = value;
    }

    if (!resolved) {
      unavailable.push({ name: definition.name, diagnostic: "unavailable" });
      continue;
    }

    data.push({
      name: definition.name,
      executable: definition.executable,
      args: definition.args,
      scope: definition.scope,
      owned: definition.owner_project_id === projectId,
      revision: definition.updated_at,
      environment,
    });
  }

  return { data, unavailable };
}

/**
 * Public runtime projections retain the vault reference and a resolution
 * status, never the value returned by `vault.decryptItem()`. Metadata lookup
 * also avoids recording a secret-read audit event merely because a dashboard
 * or API client refreshed runtime status.
 */
function publicRuntimeDefinitions(projectId: string) {
  const unavailable: Array<{ name: string; diagnostic: "unavailable" }> = [];
  const data = childMcpServers.listEffectiveChildMcpRuntimeServers(projectId).map((definition) => {
    let hasUnavailableReference = false;
    const environment = Object.fromEntries(
      Object.entries(definition.environment).map(([key, reference]) => {
        const status = vault.getItemMetadata(definition.owner_project_id, reference.vault_item_id)
          ? "resolved"
          : "unavailable";
        if (status === "unavailable") hasUnavailableReference = true;
        return [key, { vault_item_id: reference.vault_item_id, status }];
      }),
    );
    if (hasUnavailableReference) {
      unavailable.push({ name: definition.name, diagnostic: "unavailable" });
    }
    return {
      name: definition.name,
      executable: definition.executable,
      args: definition.args,
      scope: definition.scope,
      owned: definition.owner_project_id === projectId,
      revision: definition.updated_at,
      environment,
    };
  });
  return { data, unavailable };
}

/**
 * A dashboard proxy adds `x-ingenium-ui` to every forwarded request and strips
 * the server-only handoff header. Reject both a missing handoff assertion and
 * any browser-mediated request as defense in depth against rewrite mistakes.
 */
function isTrustedChildMcpRuntimeRequest(req: Request): boolean {
  return req.get(CHILD_MCP_RUNTIME_HANDOFF_HEADER) === CHILD_MCP_RUNTIME_HANDOFF_VALUE
    && req.get("x-ingenium-ui") === undefined;
}

function sendTrustedRuntimeNotFound(response: Response): void {
  response.status(404).json({ error: { code: "NOT_FOUND", message: "Not found." } });
}

function sendChildMcpError(error: unknown, response: Response): boolean {
  if (!(error instanceof Error) || error.name !== "ChildMcpServerError") return false;
  const code = (error as unknown as { code: string }).code;
  const contract: Record<string, { status: number; message: string }> = {
    INVALID_CHILD_MCP_SERVER: { status: 422, message: "Child MCP server definition is invalid." },
    GLOBAL_SCOPE_REQUIRED: { status: 403, message: "Global child MCP definitions require canonical global ownership." },
    MCP_SERVER_NAME_CONFLICT: { status: 409, message: "A child MCP server name conflicts with the visible namespace." },
    MCP_SERVER_NOT_FOUND: { status: 404, message: "Child MCP server is not registered." },
    MCP_SERVER_DISABLED: { status: 409, message: "Enable the child MCP server before requesting discovery refresh." },
    VAULT_REFERENCE_NOT_FOUND: { status: 422, message: "A referenced vault item is unavailable for this project." },
    MCP_TOOL_NAME_CONFLICT: { status: 409, message: "A discovered child MCP tool conflicts with the catalog." },
  };
  const entry = contract[code];
  if (!entry) return false;
  response.status(entry.status).json({ error: { code, message: entry.message } });
  return true;
}

mcpServersRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const data = childMcpServers.listEffectiveChildMcpServers(projectId);
  res.json({ data, total: data.length });
});

/** List effective discovery metadata without registering any dynamic transport tool. */
mcpServersRouter.get("/tools", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const data = childMcpServers.listEffectiveChildMcpTools(projectId);
  res.json({ data, total: data.length });
});

/**
 * Discovery status is safe catalog metadata: it deliberately excludes command
 * arguments, vault references, stderr, and every other runtime diagnostic.
 */
mcpServersRouter.get("/status", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const data = childMcpServers.listEffectiveChildMcpServers(projectId).map((definition) => ({
    name: definition.name,
    scope: definition.scope,
    enabled: definition.enabled,
    discovery_status: definition.discovery_status,
    discovery_diagnostic: definition.discovery_diagnostic,
    last_discovered_at: definition.last_discovered_at,
  }));
  res.json({ data, total: data.length });
});

/**
 * Browser/API-safe runtime projection. Environment entries are vault references
 * with resolution status only; the plaintext handoff is mounted separately.
 */
mcpServersRouter.get("/runtime", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const runtime = publicRuntimeDefinitions(projectId);
  res.set("Cache-Control", "no-store");
  res.json({ data: { definitions: runtime.data, unavailable: runtime.unavailable } });
});

/**
 * The sole plaintext handoff. Global API authentication still applies before
 * this router, while the dedicated path and server-only header keep it outside
 * the dashboard rewrite surface. Do not add this router under `/api/v1`.
 */
childMcpRuntimeRouter.get("/", (req, res) => {
  if (!isTrustedChildMcpRuntimeRequest(req)) {
    sendTrustedRuntimeNotFound(res);
    return;
  }
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const runtime = trustedRuntimeDefinitions(projectId);
  res.set("Cache-Control", "no-store");
  res.json({ data: { definitions: runtime.data, unavailable: runtime.unavailable } });
});

mcpServersRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const data = childMcpServers.createChildMcpServer(projectId, req.body);
    res.status(201).json({ data });
  } catch (error) {
    if (!sendChildMcpError(error, res)) throw error;
  }
});

mcpServersRouter.get("/:name/tools", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const data = childMcpServers.listOwnedChildMcpDiscoveredTools(projectId, req.params.name!);
    res.json({ data, total: data.length });
  } catch (error) {
    if (!sendChildMcpError(error, res)) throw error;
  }
});

/** Persist a bounded discovery result from a future bridge; does not perform discovery itself. */
mcpServersRouter.post("/:name/discovery", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const data = childMcpServers.recordChildMcpDiscovery(projectId, req.params.name!, req.body);
    res.json({ data });
  } catch (error) {
    if (!sendChildMcpError(error, res)) throw error;
  }
});

/**
 * These mutations only advance API-owned definition state. The connected MCP
 * process reconciles them through its bounded post-start loop, so callers never
 * need to restart OpenCode to add, remove, reconnect, or rediscover a child.
 */
mcpServersRouter.post("/:name/connect", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const data = childMcpServers.setChildMcpServerEnabled(projectId, req.params.name!, true);
    res.json({ data: { server: data, restartRequired: false } });
  } catch (error) {
    if (!sendChildMcpError(error, res)) throw error;
  }
});

mcpServersRouter.post("/:name/disconnect", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const data = childMcpServers.setChildMcpServerEnabled(projectId, req.params.name!, false);
    res.json({ data: { server: data, restartRequired: false } });
  } catch (error) {
    if (!sendChildMcpError(error, res)) throw error;
  }
});

mcpServersRouter.post("/:name/refresh", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const data = childMcpServers.requestChildMcpServerRefresh(projectId, req.params.name!);
    res.json({ data: { server: data, restartRequired: false } });
  } catch (error) {
    if (!sendChildMcpError(error, res)) throw error;
  }
});

mcpServersRouter.delete("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    childMcpServers.removeChildMcpServer(projectId, req.params.name!);
    res.status(204).send();
  } catch (error) {
    if (!sendChildMcpError(error, res)) throw error;
  }
});
