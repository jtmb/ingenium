"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type CategorizedMcpTool, type ChildMcpScope, type ChildMcpServer } from "@/lib/api";
import { opencode } from "@/lib/opencode";
import { useProject } from "@/lib/ProjectContext";
import {
  getMcpStatusLabel,
  normalizeMcpServers,
  type McpServerView,
} from "@/app/chat/components/mcp-status";

type Tab = "servers" | "tools";
type EnvironmentRow = { key: string; vaultItemId: string };

const DISCOVERY_MESSAGES: Record<string, string> = {
  unavailable: "The child server is unavailable.",
  unauthorized: "The child server could not authenticate. Check its vault references.",
  invalid_response: "The child server returned an invalid discovery response.",
  timeout: "Child server discovery timed out.",
};

/**
 * Convert backend failures into fixed, browser-safe messages.
 *
 * The API already owns the error envelope. The dashboard deliberately does not
 * render `Error.message`, because network/proxy failures can contain upstream
 * paths, credentials, or stack details when a deployment is misconfigured.
 */
export function getSafeMcpErrorMessage(error: unknown, operation: "load" | "create" | "remove" | "connect" | "disconnect" | "toggle"): string {
  const status = error && typeof error === "object" && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;

  if (status === 403) return "This project cannot register a global child MCP server.";
  if (status === 404) return "The child MCP server or tool was not found.";
  if (status === 409) return "That child MCP name conflicts with an existing catalog entry.";
  if (status === 422) return "The child MCP definition or vault reference is invalid.";

  switch (operation) {
    case "create": return "Unable to register the child MCP server.";
    case "remove": return "Unable to remove the child MCP server.";
    case "connect": return "Unable to connect to the MCP server.";
    case "disconnect": return "Unable to disconnect from the MCP server.";
    case "toggle": return "Unable to update the tool state.";
    default: return "Unable to refresh MCP server data.";
  }
}

/** Return only the fixed diagnostic text supported by the discovery contract. */
export function getSafeDiscoveryMessage(diagnostic: unknown): string | null {
  return typeof diagnostic === "string" && diagnostic in DISCOVERY_MESSAGES
    ? DISCOVERY_MESSAGES[diagnostic] ?? null
    : null;
}

function discoveryLabel(server: ChildMcpServer): string {
  if (server.discovery_status === "ready") return "Healthy";
  if (server.discovery_status === "failed") return "Failed";
  return "Pending";
}

function discoveryTone(server: ChildMcpServer): string {
  if (server.discovery_status === "ready") return "bg-[var(--color-success-bg)] text-[var(--color-success-text)]";
  if (server.discovery_status === "failed") return "bg-[var(--color-error-bg)] text-[var(--color-error-text)]";
  return "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]";
}

function connectionTone(status: McpServerView | undefined): string {
  if (status?.connected) return "bg-[var(--color-success-bg)] text-[var(--color-success-text)]";
  if (status?.status === "failed" || status?.status === "needs_auth" || status?.status === "needs_client_registration") {
    return "bg-[var(--color-error-bg)] text-[var(--color-error-text)]";
  }
  return "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]";
}

function formatVaultReference(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
}

function makeEnvironment(rows: EnvironmentRow[]): Record<string, { vault_item_id: string }> {
  return Object.fromEntries(
    rows
      .map((row) => ({ key: row.key.trim(), vaultItemId: row.vaultItemId.trim() }))
      .filter((row) => row.key || row.vaultItemId)
      .map((row) => [row.key, { vault_item_id: row.vaultItemId }]),
  );
}

function getServerToolsCount(server: ChildMcpServer, discoveredTools: Array<{ server_id: string }>): number {
  return discoveredTools.filter((tool) => tool.server_id === server.id).length;
}

export default function McpServerManager() {
  const project = useProject();
  const [tab, setTab] = useState<Tab>("servers");
  const [servers, setServers] = useState<ChildMcpServer[]>([]);
  const [discoveredTools, setDiscoveredTools] = useState<Array<{ server_id: string }>>([]);
  const [runtimeStatuses, setRuntimeStatuses] = useState<McpServerView[]>([]);
  const [categories, setCategories] = useState<CategorizedMcpTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(true);
  const [serverName, setServerName] = useState("");
  const [executable, setExecutable] = useState("");
  const [argsText, setArgsText] = useState("");
  const [scope, setScope] = useState<ChildMcpScope>("project");
  const [environmentRows, setEnvironmentRows] = useState<EnvironmentRow[]>([]);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");

  const loadData = useCallback(async () => {
    setRefreshing(true);
    setPageError(null);
    setLifecycleError(null);
    setServerError(null);
    setToolError(null);

    const [serverResult, discoveredResult, categoryResult, runtimeResult] = await Promise.allSettled([
      api.mcpServers.list(project),
      api.mcpServers.listTools(project),
      api.mcpTools.list(project, true),
      opencode.mcp.status(),
    ]);

    if (serverResult.status === "fulfilled") {
      setServers(Array.isArray(serverResult.value.data) ? serverResult.value.data : []);
    } else {
      setServers([]);
      setPageError(getSafeMcpErrorMessage(serverResult.reason, "load"));
    }

    if (discoveredResult.status === "fulfilled") {
      setDiscoveredTools(Array.isArray(discoveredResult.value.data) ? discoveredResult.value.data : []);
    } else {
      setDiscoveredTools([]);
      setPageError((current) => current ?? "Unable to refresh discovered child MCP tools.");
    }

    if (categoryResult.status === "fulfilled") {
      setCategories(Array.isArray(categoryResult.value.data) ? categoryResult.value.data : []);
    } else {
      setCategories([]);
      setToolError("Unable to refresh the MCP tool catalog.");
    }

    if (runtimeResult.status === "fulfilled") {
      const normalized = normalizeMcpServers(runtimeResult.value);
      if (normalized) setRuntimeStatuses(normalized);
      else {
        setRuntimeStatuses([]);
        setLifecycleError("MCP connection status is unavailable. Definitions and discovery remain available.");
      }
    } else {
      setRuntimeStatuses([]);
      setLifecycleError("MCP connection status is unavailable. Definitions and discovery remain available.");
    }

    setLoading(false);
    setRefreshing(false);
  }, [project]);

  useEffect(() => { void loadData(); }, [loadData]);

  const runtimeByName = useMemo(
    () => new Map(runtimeStatuses.map((status) => [status.name, status])),
    [runtimeStatuses],
  );

  const totalTools = categories.reduce((total, category) => total + category.total_count, 0);
  const enabledTools = categories.reduce((total, category) => total + category.enabled_count, 0);
  const categoryNames = categories.map((category) => category.category);
  const filteredCategories = categories
    .filter((category) => categoryFilter === "All" || category.category === categoryFilter)
    .map((category) => ({
      ...category,
      tools: search.trim()
        ? category.tools.filter((tool) => tool.tool_name.toLowerCase().includes(search.trim().toLowerCase()))
        : category.tools,
    }))
    .filter((category) => category.tools.length > 0);

  const resetForm = () => {
    setServerName("");
    setExecutable("");
    setArgsText("");
    setScope("project");
    setEnvironmentRows([]);
  };

  const createServer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!serverName.trim() || !executable.trim()) return;

    setBusyAction("create");
    setServerError(null);
    try {
      await api.mcpServers.create({
        name: serverName.trim(),
        executable: executable.trim(),
        args: argsText.split(/\r?\n/).map((arg) => arg.trim()).filter(Boolean),
        environment: makeEnvironment(environmentRows),
        scope,
      }, project);
      resetForm();
      setShowForm(false);
      await loadData();
    } catch (error) {
      setServerError(getSafeMcpErrorMessage(error, "create"));
    } finally {
      setBusyAction(null);
    }
  };

  const removeServer = async (server: ChildMcpServer) => {
    if (!window.confirm(`Remove child MCP server "${server.name}"?`)) return;
    setBusyAction(`remove:${server.name}`);
    setServerError(null);
    try {
      await api.mcpServers.remove(server.name, project);
      await loadData();
    } catch (error) {
      setServerError(getSafeMcpErrorMessage(error, "remove"));
    } finally {
      setBusyAction(null);
    }
  };

  const connectOrDisconnect = async (server: ChildMcpServer, connected: boolean) => {
    const action = connected ? "disconnect" : "connect";
    setBusyAction(`${action}:${server.name}`);
    setLifecycleError(null);
    try {
      if (connected) await opencode.mcp.disconnect(server.name);
      else await opencode.mcp.connect(server.name);
      await loadData();
    } catch (error) {
      setLifecycleError(getSafeMcpErrorMessage(error, action));
    } finally {
      setBusyAction(null);
    }
  };

  const toggleTool = async (toolName: string, enabled: boolean) => {
    setBusyAction(`tool:${toolName}`);
    setToolError(null);
    try {
      await api.mcpTools.toggle(toolName, !enabled, project);
      setCategories((current) => current.map((category) => {
        if (!category.tools.some((tool) => tool.tool_name === toolName)) return category;
        return {
          ...category,
          enabled_count: category.enabled_count + (enabled ? -1 : 1),
          tools: category.tools.map((tool) => tool.tool_name === toolName ? { ...tool, enabled: !enabled } : tool),
        };
      }));
    } catch (error) {
      setToolError(getSafeMcpErrorMessage(error, "toggle"));
    } finally {
      setBusyAction(null);
    }
  };

  const toggleCategory = async (categoryName: string, enabled: boolean) => {
    setBusyAction(`category:${categoryName}`);
    setToolError(null);
    try {
      await api.mcpTools.toggleCategory(categoryName, enabled, project);
      setCategories((current) => current.map((category) => category.category === categoryName
        ? { ...category, enabled_count: enabled ? category.total_count : 0, tools: category.tools.map((tool) => ({ ...tool, enabled })) }
        : category));
    } catch (error) {
      setToolError(getSafeMcpErrorMessage(error, "toggle"));
    } finally {
      setBusyAction(null);
    }
  };

  const addEnvironmentRow = () => setEnvironmentRows((rows) => [...rows, { key: "", vaultItemId: "" }]);
  const updateEnvironmentRow = (index: number, field: keyof EnvironmentRow, value: string) => {
    setEnvironmentRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  };
  const removeEnvironmentRow = (index: number) => {
    setEnvironmentRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)]">
        <h1 className="mr-4 text-3xl font-bold">MCP Servers</h1>
        <button
          type="button"
          onClick={() => setTab("servers")}
          className={`rounded-t px-4 py-2.5 text-sm font-medium ${tab === "servers" ? "border border-b-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-nav-text-active)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"}`}
          aria-pressed={tab === "servers"}
        >
          Servers
          <span className="ml-2 rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-xs">{servers.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("tools")}
          className={`rounded-t px-4 py-2.5 text-sm font-medium ${tab === "tools" ? "border border-b-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-nav-text-active)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"}`}
          aria-pressed={tab === "tools"}
        >
          Tools
          <span className="ml-2 rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-xs">{totalTools}</span>
        </button>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={refreshing}
          className="ml-auto mb-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:cursor-wait disabled:opacity-50"
          aria-label="Refresh MCP servers"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {pageError && <div role="alert" className="rounded border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-4 py-3 text-sm text-[var(--color-error-text)]">{pageError}</div>}
      {lifecycleError && <div role="status" className="rounded border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning-text)]">{lifecycleError}</div>}

      {tab === "servers" && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Configured child servers</h2>
              <p className="text-sm text-[var(--color-text-muted)]">Commands run through the supported MCP boundary. Secret values stay in the vault.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowForm((visible) => !visible)}
              className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
            >
              {showForm ? "Hide form" : "Add server"}
            </button>
          </div>

          {showForm && (
            <form onSubmit={createServer} className="space-y-4 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Server name</span>
                  <input aria-label="Server name" value={serverName} onChange={(event) => setServerName(event.target.value)} placeholder="calendar" className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm" />
                  <span className="block text-xs text-[var(--color-text-muted)]">Lowercase namespace used in discovered tool names.</span>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Command / executable</span>
                  <input aria-label="Command / executable" value={executable} onChange={(event) => setExecutable(event.target.value)} placeholder="npx" className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm" />
                  <span className="block text-xs text-[var(--color-text-muted)]">Shell-free executable path; do not enter a shell command.</span>
                </label>
              </div>

              <label className="block space-y-1 text-sm">
                <span className="font-medium">Arguments</span>
                <textarea aria-label="Arguments" value={argsText} onChange={(event) => setArgsText(event.target.value)} rows={3} placeholder={'--yes\n@example/calendar'} className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm" />
                <span className="block text-xs text-[var(--color-text-muted)]">One argument per line. Values are passed without shell interpolation.</span>
              </label>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium">Vault environment references</h3>
                    <p className="text-xs text-[var(--color-text-muted)]">Only vault item IDs are sent; plaintext values are never accepted here.</p>
                  </div>
                  <button type="button" onClick={addEnvironmentRow} className="rounded border border-[var(--color-border)] px-2.5 py-1.5 text-xs hover:bg-[var(--color-surface-hover)]">Add variable</button>
                </div>
                {environmentRows.length === 0 && <p className="rounded bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-text-muted)]">No environment references configured.</p>}
                {environmentRows.map((row, index) => (
                  <div key={`env-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2">
                    <input aria-label={`Environment key ${index + 1}`} value={row.key} onChange={(event) => updateEnvironmentRow(index, "key", event.target.value)} placeholder="API_TOKEN" className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm" />
                    <input aria-label={`Vault item ID ${index + 1}`} value={row.vaultItemId} onChange={(event) => updateEnvironmentRow(index, "vaultItemId", event.target.value)} placeholder="Vault item UUID" className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm" />
                    <button type="button" onClick={() => removeEnvironmentRow(index)} aria-label={`Remove environment variable ${index + 1}`} className="rounded border border-[var(--color-border)] px-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]">Remove</button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1 text-sm">
                  <span className="block font-medium">Scope</span>
                  <select aria-label="Scope" value={scope} onChange={(event) => setScope(event.target.value as ChildMcpScope)} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] cursor-pointer">
                    <option value="project">This project</option>
                    <option value="global">Global project</option>
                  </select>
                </label>
                <button type="submit" disabled={busyAction === "create" || !serverName.trim() || !executable.trim()} className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {busyAction === "create" ? "Registering…" : "Register server"}
                </button>
              </div>
              {serverError && <p role="alert" className="text-sm text-[var(--color-error-text)]">{serverError}</p>}
            </form>
          )}

          {loading && servers.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">Loading MCP servers…</p>}
          {!loading && servers.length === 0 && <div className="rounded border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-muted)]">No child MCP servers are configured.</div>}

          <div className="space-y-3">
            {servers.map((server) => {
              const runtime = runtimeByName.get(server.name);
              const connected = runtime?.connected ?? false;
              const toolCount = getServerToolsCount(server, discoveredTools);
              return (
                <article key={server.id} className="space-y-4 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{server.name}</h3>
                        <span className="rounded bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)]">{server.scope}</span>
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${discoveryTone(server)}`}>{discoveryLabel(server)}</span>
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${connectionTone(runtime)}`}>{runtime ? getMcpStatusLabel(runtime.status) : "Not connected"}</span>
                      </div>
                      <p className="mt-2 break-all font-mono text-sm text-[var(--color-text-secondary)]">
                        {server.executable}{server.args.length ? ` ${server.args.join(" ")}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button type="button" onClick={() => void connectOrDisconnect(server, connected)} disabled={busyAction === `connect:${server.name}` || busyAction === `disconnect:${server.name}`} className="rounded border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] disabled:cursor-wait disabled:opacity-50">
                        {busyAction === `connect:${server.name}` || busyAction === `disconnect:${server.name}` ? "Working…" : connected ? "Disconnect" : "Connect"}
                      </button>
                      <button type="button" onClick={() => void loadData()} disabled={refreshing} className="rounded border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] disabled:opacity-50">Refresh</button>
                      <button type="button" onClick={() => void removeServer(server)} disabled={busyAction === `remove:${server.name}`} className="rounded border border-[var(--color-error-border)] px-3 py-2 text-sm text-[var(--color-error-text)] hover:bg-[var(--color-error-bg)] disabled:opacity-50">Remove</button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                    <div className="rounded bg-[var(--color-surface-muted)] p-3"><span className="block text-xs text-[var(--color-text-muted)]">Discovered tools</span><strong>{toolCount}</strong></div>
                    <div className="rounded bg-[var(--color-surface-muted)] p-3"><span className="block text-xs text-[var(--color-text-muted)]">Runtime tools</span><strong>{runtime?.toolCount ?? "—"}</strong></div>
                    <div className="rounded bg-[var(--color-surface-muted)] p-3"><span className="block text-xs text-[var(--color-text-muted)]">Last discovery</span><strong className="text-xs">{formatDate(server.last_discovered_at)}</strong></div>
                    <div className="rounded bg-[var(--color-surface-muted)] p-3"><span className="block text-xs text-[var(--color-text-muted)]">Vault refs</span><strong>{Object.keys(server.environment ?? {}).length}</strong></div>
                  </div>

                  {Object.keys(server.environment ?? {}).length > 0 && (
                    <div className="space-y-1">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Environment references</h4>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(server.environment).map(([key, reference]) => (
                          <span key={key} className="rounded border border-[var(--color-border)] px-2 py-1 font-mono text-xs" title="Vault item reference; secret value is not exposed">
                            {key} = {formatVaultReference(reference.vault_item_id)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {server.discovery_status === "failed" && getSafeDiscoveryMessage(server.discovery_diagnostic) && (
                    <p role="status" className="text-sm text-[var(--color-error-text)]">{getSafeDiscoveryMessage(server.discovery_diagnostic)}</p>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}

      {tab === "tools" && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2">
              <input aria-label="Search tools" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tools…" className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm md:w-72" />
              <select aria-label="Tool category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] cursor-pointer">
                <option value="All">All categories</option>
                {categoryNames.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </div>
            <div className="text-sm text-[var(--color-text-muted)]">
              <strong className="text-[var(--color-success-text)]">{enabledTools}</strong> enabled · <strong>{totalTools - enabledTools}</strong> disabled · <strong>{totalTools}</strong> total
            </div>
          </div>
          {toolError && <p role="alert" className="text-sm text-[var(--color-error-text)]">{toolError}</p>}
          {loading && categories.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">Loading MCP tool catalog…</p>}
          <div className="space-y-3">
            {filteredCategories.map((category) => {
              const allEnabled = category.enabled_count === category.total_count;
              return (
                <section key={category.category} className="overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:shadow-md transition-shadow">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3">
                    <h2 className="font-semibold text-sm">{category.category}</h2>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--color-text-muted)]">{category.enabled_count}/{category.total_count} enabled</span>
                      <button type="button" onClick={() => void toggleCategory(category.category, !allEnabled)} disabled={busyAction === `category:${category.category}`} className="rounded border border-[var(--color-border)] px-2.5 py-1.5 text-xs hover:bg-[var(--color-surface)] disabled:opacity-50">
                        {busyAction === `category:${category.category}` ? "Updating…" : allEnabled ? "Disable all" : "Enable all"}
                      </button>
                    </div>
                  </div>
                  <div className="divide-y divide-[var(--color-border)]">
                    {category.tools.map((tool) => (
                      <div key={tool.tool_name} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[var(--color-surface-hover)]">
                        <span className={`break-all font-mono text-xs ${tool.enabled ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)]"}`}>{tool.tool_name}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={tool.enabled}
                          aria-label={`${tool.enabled ? "Disable" : "Enable"} ${tool.tool_name}`}
                          onClick={() => void toggleTool(tool.tool_name, tool.enabled)}
                          disabled={busyAction === `tool:${tool.tool_name}`}
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${tool.enabled ? "bg-green-500" : "bg-[var(--color-border)]"} disabled:opacity-50`}
                        >
                          <span className={`absolute top-1 h-3 w-3 rounded-full bg-[var(--color-surface)] transition-transform ${tool.enabled ? "left-5" : "left-1"}`} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
            {!loading && filteredCategories.length === 0 && <div className="rounded border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-muted)]">No tools match the current filters.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
