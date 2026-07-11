"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api } from "../../lib/api";

export default function MCPToolsPage() {
  const project = useProject();
  const [tools, setTools] = useState<Array<{ tool_name: string; enabled: boolean }>>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api.mcpTools.list(project).then((r) => setTools(r.data || [])).catch(() => {});
  }, [project]);

  const toggle = async (name: string, enabled: boolean) => {
    try {
      await api.mcpTools.toggle(name, !enabled, project);
      setTools((prev) => prev.map(t => t.tool_name === name ? { ...t, enabled: !enabled } : t));
    } catch {}
  };

  const filtered = filter ? tools.filter(t => t.tool_name.includes(filter)) : tools;
  const enabledCount = tools.filter(t => t.enabled).length;
  const disabledCount = tools.filter(t => !t.enabled).length;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">MCP Tools</h1>
        <div className="text-sm text-gray-500 space-x-3">
          <span><strong className="text-green-600">{enabledCount}</strong> enabled</span>
          <span><strong className="text-red-600">{disabledCount}</strong> disabled</span>
          <span><strong>{tools.length}</strong> total</span>
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search tools..."
        className="border border-gray-200 rounded px-3 py-2 text-sm w-64"
      />

      {/* Tool list */}
      <div className="bg-white rounded border divide-y">
        {filtered.length === 0 && (
          <div className="p-8 text-center text-gray-400">No tools found.</div>
        )}
        {filtered.map((t) => (
          <div key={t.tool_name} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50">
            <div className="flex items-center gap-3">
              <button
                onClick={() => toggle(t.tool_name, t.enabled)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  t.enabled ? "bg-green-500" : "bg-gray-300"
                }`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  t.enabled ? "translate-x-[18px]" : "translate-x-1"
                }`} />
              </button>
              <span className={`font-mono text-sm ${t.enabled ? "text-gray-900" : "text-gray-400"}`}>
                {t.tool_name}
              </span>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded ${
              t.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
            }`}>{t.enabled ? "Enabled" : "Disabled"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
