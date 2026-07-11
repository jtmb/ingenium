"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api, Server } from "../../lib/api";

interface CategorizedTool {
  category: string;
  enabled_count: number;
  total_count: number;
  tools: Array<{ tool_name: string; enabled: boolean }>;
}

export default function MCPServersPage() {
  const project = useProject();
  const [tab, setTab] = useState<"servers" | "tools">("servers");
  
  // Servers tab state
  const [servers, setServers] = useState<Server[]>([]);
  const [isGlobal, setIsGlobal] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");

  // Tools tab state
  const [categories, setCategories] = useState<CategorizedTool[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  
  // Load servers
  useEffect(() => {
    api.servers.list(project).then((r) => { setServers(r.data); setIsGlobal(r.is_global); }).catch(() => {});
  }, [project]);

  // Load tools when tab switches
  useEffect(() => {
    if (tab === "tools") {
      api.mcpTools.list(project, true).then((r) => setCategories(r.data || [])).catch(() => {});
    }
  }, [tab, project]);

  const createServer = async () => {
    if (!name || !command) return;
    const res = await api.servers.create(name, command, project);
    setServers([res.data, ...servers]);
    setName(""); setCommand("");
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
      <div className="flex items-center gap-1 border-b border-gray-200">
        <h1 className="text-2xl font-bold mr-6">MCP</h1>
        <button onClick={() => setTab("servers")} className={`px-4 py-2.5 text-sm font-medium rounded-t transition-colors ${
          tab === "servers" ? "bg-white text-blue-700 border border-b-white border-gray-200 -mb-px" : "text-gray-500 hover:text-gray-700"
        }`}>Servers</button>
        <button onClick={() => setTab("tools")} className={`px-4 py-2.5 text-sm font-medium rounded-t transition-colors ${
          tab === "tools" ? "bg-white text-blue-700 border border-b-white border-gray-200 -mb-px" : "text-gray-500 hover:text-gray-700"
        }`}>
          Tools
          <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{totalTools}</span>
        </button>
      </div>

      {/* ── SERVERS TAB ── */}
      {tab === "servers" && (
        <div className="space-y-8">
          <div className="bg-white p-4 rounded border space-y-3 hover:shadow-md transition-shadow">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Server name" className="border p-2 rounded w-full text-sm" />
            <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Command (e.g. kaban mcp)" className="border p-2 rounded w-full text-sm" />
            <button onClick={createServer} className="bg-blue-600 text-white p-2 rounded text-sm hover:bg-blue-700">Add Server</button>
          </div>
          <div className="space-y-2">
            {servers.map((s) => (
              <div key={s.id} className="bg-white p-4 rounded border flex items-center justify-between hover:shadow-md transition-shadow">
                <div>
                  <span className="font-medium text-sm">{s.name}</span>
                  <span className="text-xs text-gray-500 ml-2">{s.command}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  s.source === "ingenium"
                    ? (s.running ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")
                    : isGlobal ? (s.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500") : "bg-blue-100 text-blue-700"
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
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tools..." className="border border-gray-200 rounded px-3 py-1.5 text-sm w-56" />
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="border border-gray-200 rounded px-3 py-1.5 text-sm bg-white">
                <option value="All">All categories</option>
                {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="text-sm text-gray-500 space-x-3">
              <span><strong className="text-green-600">{enabledTools}</strong> enabled</span>
              <span><strong className="text-red-600">{totalTools - enabledTools}</strong> disabled</span>
              <span><strong>{totalTools}</strong> total</span>
            </div>
          </div>

          {/* Categorized tool list */}
          <div className="space-y-3">
            {filteredCategories.map((cat) => {
              const allEnabled = cat.enabled_count === cat.total_count;
              const noneEnabled = cat.enabled_count === 0;
              return (
                <div key={cat.category} className="bg-white rounded border overflow-hidden hover:shadow-md transition-shadow">
                  {/* Category header */}
                  <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b">
                    <span className="font-semibold text-sm text-gray-800">{cat.category}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{cat.enabled_count}/{cat.total_count} enabled</span>
                      <button onClick={() => toggleCategory(cat.category, !allEnabled)} className="text-xs px-2.5 py-1 border border-gray-200 rounded hover:bg-white transition-colors">
                        {noneEnabled ? "Enable All" : "Disable All"}
                      </button>
                    </div>
                  </div>
                  {/* Tools */}
                  <div className="divide-y">
                    {cat.tools.map(t => (
                      <div key={t.tool_name} className="flex items-center justify-between px-4 py-2 hover:bg-gray-50">
                        <div className="flex items-center gap-3">
                          <button onClick={() => toggleTool(t.tool_name, t.enabled)} className={`relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors shrink-0 ${t.enabled ? "bg-green-400" : "bg-gray-300"}`}>
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${t.enabled ? "translate-x-[18px]" : "translate-x-1"}`} />
                          </button>
                          <span className={`font-mono text-xs ${t.enabled ? "text-gray-800" : "text-gray-400"}`}>{t.tool_name}</span>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          t.enabled ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"
                        }`}>{t.enabled ? "Enabled" : "Disabled"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {filteredCategories.length === 0 && (
              <div className="bg-white rounded border p-8 text-center text-gray-400">No tools match your filters.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
