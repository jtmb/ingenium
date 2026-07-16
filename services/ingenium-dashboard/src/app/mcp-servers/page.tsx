"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api, Server } from "../../lib/api";
import { badgeTones, BADGE_BASE } from "@/lib/badgeTones";

interface CategorizedTool {
  category: string;
  enabled_count: number;
  total_count: number;
  tools: Array<{ tool_name: string; enabled: boolean }>;
}

/**
 * MCPServersPage — Dual-tab page for managing MCP servers and their tools.
 *
 * "Servers" tab: Register/unregister child MCP server processes.
 * "Tools" tab: Browse 212 catalog tools across 24 categories with search,
 * category filter, and individual tool toggles (enable/disable).
 *
 * Category-level enable/disable is an optimistic update that flips all
 * tools in a category at once via a single API call.
 */
export default function MCPServersPage() {
  const project = useProject();
  const [tab, setTab] = useState<"servers" | "tools">("servers");
  
  // Servers tab state
  const [servers, setServers] = useState<Server[]>([]);
  const [isGlobal, setIsGlobal] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  // Tools tab state
  const [categories, setCategories] = useState<CategorizedTool[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  
  // Load servers
  useEffect(() => {
    api.servers.list(project).then((r) => { setServers(r.data); setIsGlobal(r.is_global); }).catch(() => {});
  }, [project]);

  // Load tools on mount (for badge count)
  useEffect(() => {
    api.mcpTools.list(project, true).then((r) => setCategories(r.data || [])).catch(() => {});
  }, [project]);

  const createServer = async () => {
    if (!name || !command) return;
    try {
      const res = await api.servers.create(name, command, project);
      setServers([res.data, ...servers]);
      setName(""); setCommand("");
      setServerError(null);
    } catch (err: any) {
      setServerError(err?.message || "Failed to add server. Check the API connection.");
    }
  };

  const toggleTool = async (toolName: string, enabled: boolean) => {
    try {
      await api.mcpTools.toggle(toolName, !enabled, project);
      setCategories(prev => prev.map(c => ({
        ...c,
        enabled_count: c.tools.some(t => t.tool_name === toolName)
          ? c.enabled_count + (!enabled ? 1 : -1) : c.enabled_count,
        tools: c.tools.map(t => t.tool_name === toolName ? { ...t, enabled: !enabled } : t),
      })));
    } catch {}
  };

  const toggleCategory = async (category: string, enabled: boolean) => {
    try {
      await api.mcpTools.toggleCategory(category, enabled, project);
      setCategories(prev => prev.map(c => c.category === category ? {
        ...c, enabled_count: enabled ? c.total_count : 0,
        tools: c.tools.map(t => ({ ...t, enabled })),
      } : c));
    } catch {}
  };

  // Filter tools
  const filteredCategories = categories
    .filter(c => categoryFilter === "All" || c.category === categoryFilter)
    .map(c => ({
      ...c,
      tools: search
        ? c.tools.filter(t => t.tool_name.toLowerCase().includes(search.toLowerCase()))
        : c.tools,
    }))
    .filter(c => c.tools.length > 0);

  const allCategories = categories.map(c => c.category);
  const totalTools = categories.reduce((s, c) => s + c.total_count, 0);
  const enabledTools = categories.reduce((s, c) => s + c.enabled_count, 0);

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-[var(--color-border)]">
        <h1 className="text-2xl font-bold mr-6">MCP</h1>
        <button onClick={() => setTab("servers")} className={`px-4 py-2.5 text-sm font-medium rounded-t transition-colors ${
          tab === "servers" ? "bg-[var(--color-surface)] text-blue-700 border border-b-[var(--color-border)] border-[var(--color-border)] -mb-px" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        }`}>Servers</button>
        <button onClick={() => setTab("tools")} className={`px-4 py-2.5 text-sm font-medium rounded-t transition-colors ${
          tab === "tools" ? "bg-[var(--color-surface)] text-blue-700 border border-b-[var(--color-border)] border-[var(--color-border)] -mb-px" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        }`}>
          Tools
          <span className="ml-1.5 text-xs bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] px-1.5 py-0.5 rounded">{totalTools}</span>
        </button>
      </div>

      {/* ── SERVERS TAB ── */}
      {tab === "servers" && (
        <div className="space-y-8">
          <div className="bg-[var(--color-surface)] p-4 rounded border border-[var(--color-border)] space-y-3 hover:shadow-md transition-shadow">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Server name" className="border p-2 rounded w-full text-sm" />
            <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Command (e.g. kaban mcp)" className="border p-2 rounded w-full text-sm" />
            <button onClick={createServer} className="bg-blue-600 text-white p-2 rounded text-sm hover:bg-blue-700">Add Server</button>
            {serverError && <p className="text-sm text-red-600 mt-2">{serverError}</p>}
          </div>
          <div className="space-y-2">
            {servers.map((s) => (
              <div key={s.id} className="bg-[var(--color-surface)] p-4 rounded border border-[var(--color-border)] flex items-center justify-between hover:shadow-md transition-shadow">
                <div>
                  <span className="font-medium text-sm">{s.name}</span>
                  <span className="text-xs text-[var(--color-text-muted)] ml-2">{s.command}</span>
                </div>
                <span className={`${BADGE_BASE} ${
                  s.source === "ingenium"
                    ? (s.running ? badgeTones("green") : badgeTones("muted"))
                    : isGlobal ? (s.enabled ? badgeTones("green") : badgeTones("muted")) : badgeTones("blue")
                }`}>
                  {s.source === "ingenium" ? (s.running ? "Running" : "Stopped") : isGlobal ? (s.enabled ? "Enabled" : "Disabled") : "External"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TOOLS TAB ── */}
      {tab === "tools" && (
        <div className="space-y-4">
          {/* Stats bar */}
          <div className="flex items-center justify-between">
            <div className="flex gap-3 items-center">
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tools..." className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm w-full max-w-xs" />
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer min-w-[140px]">
                <option value="All">All categories</option>
                {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="text-sm text-[var(--color-text-muted)] space-x-3">
              <span><strong className="text-[var(--color-success-text)]">{enabledTools}</strong> enabled</span>
              <span><strong className="text-[var(--color-error-text)]">{totalTools - enabledTools}</strong> disabled</span>
              <span><strong>{totalTools}</strong> total</span>
            </div>
          </div>

          {/* Categorized tool list */}
          <div className="space-y-3">
            {filteredCategories.map((cat) => {
              const allEnabled = cat.enabled_count === cat.total_count;
              const noneEnabled = cat.enabled_count === 0;
              return (
                <div key={cat.category} className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] overflow-hidden hover:shadow-md transition-shadow">
                  {/* Category header */}
                  <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--color-surface-muted)] border-b">
                    <span className="font-semibold text-sm text-[var(--color-text-primary)]">{cat.category}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--color-text-muted)]">{cat.enabled_count}/{cat.total_count} enabled</span>
                      <button onClick={() => toggleCategory(cat.category, !allEnabled)} className="text-xs px-2.5 py-1 border border-[var(--color-border)] rounded hover:bg-[var(--color-surface)] transition-colors">
                        {noneEnabled ? "Enable All" : "Disable All"}
                      </button>
                    </div>
                  </div>
                  {/* Tools */}
                  <div className="divide-y">
                    {cat.tools.map(t => (
                      <div key={t.tool_name} className="flex items-center justify-between px-4 py-2 hover:bg-[var(--color-surface-hover)]">
                        <div className="flex items-center gap-3">
                          <button onClick={() => toggleTool(t.tool_name, t.enabled)} className={`relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors shrink-0 ${t.enabled ? "bg-green-400" : "bg-gray-300"}`}>
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-[var(--color-surface)] transition-transform ${t.enabled ? "translate-x-[18px]" : "translate-x-1"}`} />
                          </button>
                          <span className={`font-mono text-xs ${t.enabled ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)]"}`}>{t.tool_name}</span>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          t.enabled ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)]" : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"
                        }`}>{t.enabled ? "Enabled" : "Disabled"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {filteredCategories.length === 0 && (
              <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-8 text-center text-[var(--color-text-muted)]">No tools match your filters.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
