import { Router, type Response } from "express";
import { authorization, mcpToolStates } from "ingenium-core";
import {
  buildMcpUsefulnessReport,
  createMcpUsefulnessCollector,
  enrichMcpUsefulnessReport,
  type McpUsefulnessCatalogEntry,
  type McpUsefulnessCollectionError,
  type McpUsefulnessReportCollector,
} from "../mcp-usefulness-collector.js";
import { requireProject } from "../helpers.js";
import { toAuthorizationPrincipal } from "../authorization-policy.js";

/** Handles /api/v1/mcp-tools — tool catalog queries and per-project enable/disable state. */
export interface McpToolsRouterOptions {
  usefulnessCollector?: McpUsefulnessReportCollector;
}

const REPORT_MAX_BYTES = 64 * 1024;
const REPORT_QUERY_KEYS = new Set(["project", "q", "category", "enabled", "boundary", "visibility", "invocation"]);

interface ReportFilters {
  q?: string;
  category?: string;
  enabled?: boolean;
  boundary?: "mcp-stdio" | "opencode-extension";
  visibility?: "reachable" | "unreachable" | "unknown" | "not-applicable";
  invocation?: "success" | "failed" | "not-run" | "unknown";
}

/**
 * Returns true if the tool name exists in the catalog.
 * Uses the catalog map from mcp-tool-states for O(1) lookup.
 */
function isKnownToolName(name: string, projectId?: string): boolean {
  const catalog = mcpToolStates.getAllTools(projectId);
  return catalog.has(name);
}

/**
 * Returns the set of known category names from the catalog.
 */
function getKnownCategories(projectId?: string): Set<string> {
  const categoryMap = mcpToolStates.getCategoryMap(projectId);
  return new Set(categoryMap.keys());
}

function reportError(res: Response, status: 413 | 422, code: string): void {
  res.status(status).json({ error: { code, message: "The MCP report query is invalid." } });
}

function queryString(value: unknown, maximumLength: number): { value?: string; tooLarge?: boolean; invalid?: boolean } {
  if (value === undefined) return {};
  if (typeof value !== "string" || !/^[\x20-\x7e]*$/.test(value)) return { invalid: true };
  if (value.length > maximumLength) return { tooLarge: true };
  return { value };
}

function parseReportFilters(query: Record<string, unknown>): { filters?: ReportFilters; status?: 413 | 422 } {
  if (Object.keys(query).some((key) => !REPORT_QUERY_KEYS.has(key))) return { status: 422 };

  const q = queryString(query.q, 128);
  const category = queryString(query.category, 128);
  if (q.tooLarge || category.tooLarge) return { status: 413 };
  if (q.invalid || category.invalid || q.value === "" || category.value === "") return { status: 422 };

  const enabled = query.enabled;
  if (enabled !== undefined && enabled !== "true" && enabled !== "false") return { status: 422 };
  const boundary = query.boundary;
  if (boundary !== undefined && boundary !== "mcp-stdio" && boundary !== "opencode-extension") return { status: 422 };
  const visibility = query.visibility;
  if (visibility !== undefined && visibility !== "reachable" && visibility !== "unreachable"
    && visibility !== "unknown" && visibility !== "not-applicable") return { status: 422 };
  const invocation = query.invocation;
  if (invocation !== undefined && invocation !== "success" && invocation !== "failed"
    && invocation !== "not-run" && invocation !== "unknown") return { status: 422 };

  return {
    filters: {
      ...(q.value === undefined ? {} : { q: q.value.toLowerCase() }),
      ...(category.value === undefined ? {} : { category: category.value }),
      ...(enabled === undefined ? {} : { enabled: enabled === "true" }),
      ...(boundary === undefined ? {} : { boundary }),
      ...(visibility === undefined ? {} : { visibility }),
      ...(invocation === undefined ? {} : { invocation }),
    },
  };
}

function effectiveTools(projectId: string): McpUsefulnessCatalogEntry[] {
  const catalog = Array.from(mcpToolStates.getAllTools(projectId).values());
  const stateEntries = mcpToolStates.listToolStatesWithDefaults(projectId);
  const states = new Map(stateEntries.map(({ tool_name, enabled }) => [tool_name, enabled]));
  const catalogNames = new Set(catalog.map(({ name }) => name));
  if (catalog.length !== catalogNames.size || stateEntries.length !== catalog.length || states.size !== catalog.length
    || stateEntries.some(({ tool_name }) => !catalogNames.has(tool_name))) {
    throw new Error("MCP_REPORT_STATE_MISMATCH");
  }
  return catalog.map((tool) => {
    const enabled = states.get(tool.name);
    if (enabled === undefined) throw new Error("MCP_REPORT_STATE_MISMATCH");
    return { ...tool, enabled };
  });
}

function authorizedCatalog(req: import("express").Request, projectId: string) {
  if (!req.authorizationPolicy) return mcpToolStates.getAllTools(projectId);
  const principal = req.principal;
  if (!principal) return new Map();
  return new Map(Array.from(mcpToolStates.getAllTools(projectId).entries()).filter(([, tool]) => {
    const policy = tool.authorization;
    if (!policy) return false;
    if (principal.type === "compatibility") return true;
    const authorizationPrincipal = toAuthorizationPrincipal(principal);
    if (policy.target === "installation") return authorization.requireInstallationPermission(authorizationPrincipal, policy.resource, policy.permission).allowed;
    if (policy.target === "organization") return authorization.requireOrganizationPermission(authorizationPrincipal,
      "organizationId" in principal && principal.organizationId ? principal.organizationId : "", policy.resource, policy.permission).allowed;
    if (policy.target === "private") return false;
    return authorization.requireProjectPermission(authorizationPrincipal, projectId, policy.resource, policy.permission).allowed;
  }));
}

function isBusy(error: unknown): error is McpUsefulnessCollectionError {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "MCP_REPORT_BUSY";
}

function reportUnavailable(res: Response, busy = false): void {
  res.status(503).json({
    error: {
      code: busy ? "MCP_REPORT_BUSY" : "MCP_REPORT_UNAVAILABLE",
      message: busy ? "The MCP report is busy." : "The MCP report is unavailable.",
    },
  });
}

function filterReportTools<T extends {
  name: string;
  category: string;
  enabled: boolean;
  boundary: string;
  visibility: { status: string };
  invocation: { status: string };
}>(tools: readonly T[], filters: ReportFilters): T[] {
  return tools.filter((tool) => (
    (filters.q === undefined || tool.name.includes(filters.q))
    && (filters.category === undefined || tool.category === filters.category)
    && (filters.enabled === undefined || tool.enabled === filters.enabled)
    && (filters.boundary === undefined || tool.boundary === filters.boundary)
    && (filters.visibility === undefined || tool.visibility.status === filters.visibility)
    && (filters.invocation === undefined || tool.invocation.status === filters.invocation)
  ));
}

export function createMcpToolsRouter(options: McpToolsRouterOptions = {}): Router {
  const router = Router();
  const usefulnessCollector = options.usefulnessCollector ?? createMcpUsefulnessCollector();

  // NOTE: Catalog sub-routes and /report MUST be registered before the /:name wildcard.

  router.get("/catalog", (req, res) => {
  const projectId = req.query.project === undefined ? undefined : requireProject(req, res) ?? undefined;
  if (req.query.project !== undefined && !projectId) return;
  const catalog = projectId ? authorizedCatalog(req, projectId) : mcpToolStates.getAllTools(projectId);
  const entries = Array.from(catalog.values());
  res.json({
    data: entries,
    total: entries.length,
  });
  });

  router.get("/catalog/:name", (req, res) => {
  const projectId = req.query.project === undefined ? undefined : requireProject(req, res) ?? undefined;
  if (req.query.project !== undefined && !projectId) return;
  const catalog = projectId ? authorizedCatalog(req, projectId) : mcpToolStates.getAllTools(projectId);
  const entry = catalog.get(req.params.name!);
  if (!entry) {
    res.status(404).json({
      error: { code: "TOOL_NOT_REGISTERED", message: `Tool '${req.params.name}' is not registered in the catalog` },
    });
    return;
  }
  res.json({ data: entry });
  });

  router.get("/report", async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    res.vary("Authorization");
    const projectId = requireProject(req, res);
    if (!projectId) return;
    const parsed = parseReportFilters(req.query as Record<string, unknown>);
    if (!parsed.filters) {
      reportError(res, parsed.status!, parsed.status === 413 ? "MCP_REPORT_QUERY_TOO_LARGE" : "INVALID_MCP_REPORT_QUERY");
      return;
    }

    try {
      const observation = await usefulnessCollector.collect({ project: req.query.project as string, projectId });
      const tools = effectiveTools(projectId);
      const report = enrichMcpUsefulnessReport(
        buildMcpUsefulnessReport(observation, tools, usefulnessCollector.provenance, usefulnessCollector.freshnessDurationMs),
        tools,
      );
      const data = { ...report, tools: filterReportTools(report.tools, parsed.filters) };
      const body = { project: req.query.project as string, project_id: projectId, data, total: data.tools.length };
      if (Buffer.byteLength(JSON.stringify(body), "utf8") > REPORT_MAX_BYTES) {
        reportUnavailable(res);
        return;
      }
      res.json(body);
    } catch (error) {
      reportUnavailable(res, isBusy(error));
    }
  });

// GET /api/v1/mcp-tools — list all tools with enabled/disabled state for a project.
//   ?include_categories=true — returns categorized groups instead of flat list.
  router.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const project = req.query.project as string;

  const includeCategories = req.query.include_categories === "true";
  if (includeCategories) {
    const authorized = authorizedCatalog(req, projectId);
    const tools = mcpToolStates.listCategorizedTools(projectId).map((category) => ({
      ...category,
      tools: category.tools.filter((tool) => authorized.has(tool.tool_name)),
      total_count: category.tools.filter((tool) => authorized.has(tool.tool_name)).length,
      enabled_count: category.tools.filter((tool) => tool.enabled && authorized.has(tool.tool_name)).length,
    })).filter((category) => category.total_count > 0);
    res.json({ project, project_id: projectId, data: tools, total: tools.reduce((s, g) => s + g.total_count, 0) });
  } else {
    const authorized = authorizedCatalog(req, projectId);
    const tools = mcpToolStates.listToolStatesWithDefaults(projectId).filter((tool) => authorized.has(tool.tool_name));
    res.json({ project, project_id: projectId, data: tools, total: tools.length });
  }
  });

  router.get("/:name/state", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const project = req.query.project as string;

  const toolName = req.params.name!;

  if (!isKnownToolName(toolName, projectId)) {
    res.status(404).json({
      error: { code: "TOOL_NOT_REGISTERED", message: `Tool '${toolName}' is not registered in the catalog` },
    });
    return;
  }

  // Returns the catalog default if no explicit state row exists for this tool.
  const enabled = mcpToolStates.getToolState(projectId, toolName);
  const policy = mcpToolStates.getAllTools(projectId).get(toolName)?.authorization;
  if (!policy) {
    res.status(503).json({ error: { code: "TOOL_POLICY_UNAVAILABLE", message: "The tool authorization policy is unavailable." } });
    return;
  }
  if (!authorizedCatalog(req, projectId).has(toolName)) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "The authenticated principal cannot perform this action" } });
    return;
  }
  res.json({ project, project_id: projectId, data: { tool_name: toolName, enabled, authorization: policy } });
  });

// NOTE: /category/:category must be registered before /:name so "category" is not captured as :name
  router.put("/category/:category", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const project = req.query.project as string;

  const category = req.params.category!;
  const { enabled } = req.body;
  if (typeof enabled !== "boolean") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "enabled (boolean) is required" } });
    return;
  }

  const knownCategories = getKnownCategories(projectId);
  if (!knownCategories.has(category)) {
    res.status(404).json({
      error: { code: "CATEGORY_NOT_FOUND", message: `Category '${category}' does not exist in the tool catalog` },
    });
    return;
  }

  const changed = mcpToolStates.setCategoryState(projectId, category, enabled);
  res.json({ project, project_id: projectId, data: { category, enabled, tools_changed: changed } });
  });

  router.put("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const project = req.query.project as string;

  const toolName = req.params.name!;
  const { enabled } = req.body;
  if (typeof enabled !== "boolean") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "enabled (boolean) is required" } });
    return;
  }

  if (!isKnownToolName(toolName, projectId)) {
    res.status(404).json({
      error: { code: "TOOL_NOT_REGISTERED", message: `Tool '${toolName}' is not registered in the catalog` },
    });
    return;
  }

  const state = mcpToolStates.setToolState(projectId, toolName, enabled);
  res.json({ project, project_id: projectId, data: state });
  });

  return router;
}

export const mcpToolsRouter = createMcpToolsRouter();
