"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api } from "../../lib/api";
export default function MCPServersPage() {
    const project = useProject();
    const [tab, setTab] = useState("servers");
    // Servers tab state
    const [servers, setServers] = useState([]);
    const [isGlobal, setIsGlobal] = useState(false);
    const [name, setName] = useState("");
    const [command, setCommand] = useState("");
    // Tools tab state
    const [categories, setCategories] = useState([]);
    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("All");
    // Load servers
    useEffect(() => {
        api.servers.list(project).then((r) => { setServers(r.data); setIsGlobal(r.is_global); }).catch(() => { });
    }, [project]);
    // Load tools on mount (for badge count)
    useEffect(() => {
        api.mcpTools.list(project, true).then((r) => setCategories(r.data || [])).catch(() => { });
    }, [project]);
    const createServer = async () => {
        if (!name || !command)
            return;
        const res = await api.servers.create(name, command, project);
        setServers([res.data, ...servers]);
        setName("");
        setCommand("");
    };
    const toggleTool = async (toolName, enabled) => {
        try {
            await api.mcpTools.toggle(toolName, !enabled, project);
            setCategories(prev => prev.map(c => ({
                ...c,
                enabled_count: c.tools.some(t => t.tool_name === toolName)
                    ? c.enabled_count + (!enabled ? 1 : -1) : c.enabled_count,
                tools: c.tools.map(t => t.tool_name === toolName ? { ...t, enabled: !enabled } : t),
            })));
        }
        catch { }
    };
    const toggleCategory = async (category, enabled) => {
        try {
            await api.mcpTools.toggleCategory(category, enabled, project);
            setCategories(prev => prev.map(c => c.category === category ? {
                ...c, enabled_count: enabled ? c.total_count : 0,
                tools: c.tools.map(t => ({ ...t, enabled })),
            } : c));
        }
        catch { }
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
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center gap-1 border-b border-gray-200", children: [_jsx("h1", { className: "text-2xl font-bold mr-6", children: "MCP" }), _jsx("button", { onClick: () => setTab("servers"), className: `px-4 py-2.5 text-sm font-medium rounded-t transition-colors ${tab === "servers" ? "bg-white text-blue-700 border border-b-white border-gray-200 -mb-px" : "text-gray-500 hover:text-gray-700"}`, children: "Servers" }), _jsxs("button", { onClick: () => setTab("tools"), className: `px-4 py-2.5 text-sm font-medium rounded-t transition-colors ${tab === "tools" ? "bg-white text-blue-700 border border-b-white border-gray-200 -mb-px" : "text-gray-500 hover:text-gray-700"}`, children: ["Tools", _jsx("span", { className: "ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded", children: totalTools })] })] }), tab === "servers" && (_jsxs("div", { className: "space-y-8", children: [_jsxs("div", { className: "bg-white p-4 rounded border space-y-3 hover:shadow-md transition-shadow", children: [_jsx("input", { value: name, onChange: (e) => setName(e.target.value), placeholder: "Server name", className: "border p-2 rounded w-full text-sm" }), _jsx("input", { value: command, onChange: (e) => setCommand(e.target.value), placeholder: "Command (e.g. kaban mcp)", className: "border p-2 rounded w-full text-sm" }), _jsx("button", { onClick: createServer, className: "bg-blue-600 text-white p-2 rounded text-sm hover:bg-blue-700", children: "Add Server" })] }), _jsx("div", { className: "space-y-2", children: servers.map((s) => (_jsxs("div", { className: "bg-white p-4 rounded border flex items-center justify-between hover:shadow-md transition-shadow", children: [_jsxs("div", { children: [_jsx("span", { className: "font-medium text-sm", children: s.name }), _jsx("span", { className: "text-xs text-gray-500 ml-2", children: s.command })] }), _jsx("span", { className: `text-xs px-2 py-0.5 rounded ${s.source === "ingenium"
                                        ? (s.running ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")
                                        : isGlobal ? (s.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500") : "bg-blue-100 text-blue-700"}`, children: s.source === "ingenium" ? (s.running ? "Running" : "Stopped") : isGlobal ? (s.enabled ? "Enabled" : "Disabled") : "External" })] }, s.id))) })] })), tab === "tools" && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex gap-3 items-center", children: [_jsx("input", { type: "text", value: search, onChange: (e) => setSearch(e.target.value), placeholder: "Search tools...", className: "border border-gray-200 rounded px-3 py-1.5 text-sm w-56" }), _jsxs("select", { value: categoryFilter, onChange: (e) => setCategoryFilter(e.target.value), className: "border border-gray-200 rounded px-3 py-1.5 text-sm bg-white hover:bg-gray-50 cursor-pointer", children: [_jsx("option", { value: "All", children: "All categories" }), allCategories.map(c => _jsx("option", { value: c, children: c }, c))] })] }), _jsxs("div", { className: "text-sm text-gray-500 space-x-3", children: [_jsxs("span", { children: [_jsx("strong", { className: "text-green-600", children: enabledTools }), " enabled"] }), _jsxs("span", { children: [_jsx("strong", { className: "text-red-600", children: totalTools - enabledTools }), " disabled"] }), _jsxs("span", { children: [_jsx("strong", { children: totalTools }), " total"] })] })] }), _jsxs("div", { className: "space-y-3", children: [filteredCategories.map((cat) => {
                                const allEnabled = cat.enabled_count === cat.total_count;
                                const noneEnabled = cat.enabled_count === 0;
                                return (_jsxs("div", { className: "bg-white rounded border overflow-hidden hover:shadow-md transition-shadow", children: [_jsxs("div", { className: "flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b", children: [_jsx("span", { className: "font-semibold text-sm text-gray-800", children: cat.category }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("span", { className: "text-xs text-gray-400", children: [cat.enabled_count, "/", cat.total_count, " enabled"] }), _jsx("button", { onClick: () => toggleCategory(cat.category, !allEnabled), className: "text-xs px-2.5 py-1 border border-gray-200 rounded hover:bg-white transition-colors", children: noneEnabled ? "Enable All" : "Disable All" })] })] }), _jsx("div", { className: "divide-y", children: cat.tools.map(t => (_jsxs("div", { className: "flex items-center justify-between px-4 py-2 hover:bg-gray-50", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("button", { onClick: () => toggleTool(t.tool_name, t.enabled), className: `relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors shrink-0 ${t.enabled ? "bg-green-400" : "bg-gray-300"}`, children: _jsx("span", { className: `inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${t.enabled ? "translate-x-[18px]" : "translate-x-1"}` }) }), _jsx("span", { className: `font-mono text-xs ${t.enabled ? "text-gray-800" : "text-gray-400"}`, children: t.tool_name })] }), _jsx("span", { className: `text-[10px] px-1.5 py-0.5 rounded font-medium ${t.enabled ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"}`, children: t.enabled ? "Enabled" : "Disabled" })] }, t.tool_name))) })] }, cat.category));
                            }), filteredCategories.length === 0 && (_jsx("div", { className: "bg-white rounded border p-8 text-center text-gray-400", children: "No tools match your filters." }))] })] }))] }));
}
