"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useProject } from "../../lib/ProjectContext";
import Overlay from "../components/Overlay";
import MarkdownViewer from "../components/MarkdownViewer";
import { api } from "@/lib/api";
/**
 * Agent management page.
 * Full CRUD: create, edit, enable/disable, delete agent definitions synced to OpenCode.
 */
export default function AgentsPage() {
    const project = useProject();
    const [agents, setAgents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showCreate, setShowCreate] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [selectedAgent, setSelectedAgent] = useState(null);
    // Create form state
    const [newName, setNewName] = useState("");
    const [newDesc, setNewDesc] = useState("");
    const [newCat, setNewCat] = useState("execution");
    const [newMode, setNewMode] = useState("subagent");
    const [newModel, setNewModel] = useState("");
    const [newContent, setNewContent] = useState("");
    // Edit state
    const [editContent, setEditContent] = useState("");
    const [editDesc, setEditDesc] = useState("");
    const [editModel, setEditModel] = useState("");
    const [editCat, setEditCat] = useState("");
    const fetchAgents = async () => {
        try {
            setLoading(true);
            setError(null);
            const res = await api.agents.list(project);
            setAgents(res.data);
        }
        catch (err) {
            setError(err.message || "Failed to load agents");
        }
        finally {
            setLoading(false);
        }
    };
    useEffect(() => { fetchAgents(); }, [project]);
    const handleCreate = async () => {
        if (!newName || !newContent)
            return;
        try {
            const data = { name: newName, content: newContent, description: newDesc, category: newCat, mode: newMode };
            if (newModel)
                data.model = newModel;
            await api.agents.create(data, project);
            setShowCreate(false);
            setNewName("");
            setNewDesc("");
            setNewContent("");
            setNewModel("");
            fetchAgents();
        }
        catch (err) {
            setError(err.message);
        }
    };
    const handleUpdate = async (name) => {
        try {
            const data = {};
            if (editDesc !== undefined)
                data.description = editDesc;
            if (editModel !== undefined)
                data.model = editModel;
            if (editCat !== undefined)
                data.category = editCat;
            if (editContent !== undefined)
                data.content = editContent;
            await api.agents.update(name, data, project);
            setEditingId(null);
            fetchAgents();
        }
        catch (err) {
            setError(err.message);
        }
    };
    const handleDelete = async (name) => {
        if (!window.confirm(`Delete agent "${name}"? This will remove its file from disk.`))
            return;
        try {
            await api.agents.delete(name, project);
            fetchAgents();
        }
        catch (err) {
            setError(err.message);
        }
    };
    const handleToggle = async (agent) => {
        try {
            if (agent.enabled)
                await api.agents.disable(agent.name, project);
            else
                await api.agents.enable(agent.name, project);
            fetchAgents();
        }
        catch (err) {
            setError(err.message);
        }
    };
    const startEdit = (agent) => {
        setEditingId(agent.id);
        setEditContent(agent.content);
        setEditDesc(agent.description);
        setEditModel(agent.model || "");
        setEditCat(agent.category);
    };
    const categoryOrder = ["primary", "execution", "research", "security"];
    const grouped = categoryOrder
        .map(cat => ({ category: cat, items: agents.filter(a => a.category === cat) }))
        .filter(g => g.items.length > 0);
    return (_jsxs("div", { className: "space-y-8", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h1", { className: "text-3xl font-bold", children: "Agents" }), _jsx("button", { onClick: () => setShowCreate(!showCreate), className: "bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700", children: showCreate ? "Cancel" : "Add Agent" })] }), error && (_jsxs("div", { className: "bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded", children: [error, _jsx("button", { onClick: () => setError(null), className: "float-right font-bold", children: "\u00D7" })] })), showCreate && (_jsxs("div", { className: "bg-white p-4 rounded border space-y-4 hover:shadow-md transition-shadow", children: [_jsx("h2", { className: "text-xl font-semibold", children: "Create New Agent" }), _jsx("input", { className: "border p-2 rounded w-full", placeholder: "Agent name (e.g., ingenium-qa)", value: newName, onChange: e => setNewName(e.target.value) }), _jsx("input", { className: "border p-2 rounded w-full", placeholder: "Description", value: newDesc, onChange: e => setNewDesc(e.target.value) }), _jsxs("div", { className: "flex gap-4", children: [_jsxs("select", { className: "border p-2 rounded flex-1 hover:bg-gray-50 cursor-pointer", value: newCat, onChange: e => setNewCat(e.target.value), children: [_jsx("option", { value: "primary", children: "Primary" }), _jsx("option", { value: "execution", children: "Execution" }), _jsx("option", { value: "research", children: "Research" }), _jsx("option", { value: "security", children: "Security" })] }), _jsxs("select", { className: "border p-2 rounded flex-1 hover:bg-gray-50 cursor-pointer", value: newMode, onChange: e => setNewMode(e.target.value), children: [_jsx("option", { value: "primary", children: "Primary" }), _jsx("option", { value: "subagent", children: "Subagent" })] })] }), _jsx("input", { className: "border p-2 rounded w-full", placeholder: "Model (optional, e.g., deepseek/deepseek-v4-flash)", value: newModel, onChange: e => setNewModel(e.target.value) }), _jsx("textarea", { className: "border p-2 rounded w-full font-mono text-sm", rows: 10, placeholder: "Full agent .md content after the frontmatter...", value: newContent, onChange: e => setNewContent(e.target.value) }), _jsx("button", { onClick: handleCreate, className: "bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700", children: "Create Agent" })] })), loading && _jsx("p", { className: "text-gray-500", children: "Loading agents..." }), !loading && agents.length === 0 && (_jsxs("div", { className: "text-center py-12 text-gray-500", children: [_jsx("p", { className: "text-lg", children: "No agents registered" }), _jsx("p", { className: "text-sm", children: "Use \"Add Agent\" to create your first agent. Agents are written to .opencode/agents/ and synced to global config." })] })), grouped.map(group => (_jsxs("div", { children: [_jsx("h2", { className: "text-2xl font-semibold capitalize mb-4", children: group.category }), _jsx("div", { className: "space-y-4", children: group.items.map(agent => (_jsx("div", { className: "bg-white p-4 rounded border hover:shadow-md transition-shadow cursor-pointer", onClick: () => setSelectedAgent(agent), children: editingId === agent.id ? (_jsxs("div", { className: "space-y-4", children: [_jsx("input", { className: "border p-2 rounded w-full", placeholder: "Description", value: editDesc, onChange: e => setEditDesc(e.target.value) }), _jsxs("div", { className: "flex gap-4", children: [_jsxs("select", { className: "border p-2 rounded flex-1 hover:bg-gray-50 cursor-pointer", value: editCat, onChange: e => setEditCat(e.target.value), children: [_jsx("option", { value: "primary", children: "Primary" }), _jsx("option", { value: "execution", children: "Execution" }), _jsx("option", { value: "research", children: "Research" }), _jsx("option", { value: "security", children: "Security" })] }), _jsx("input", { className: "border p-2 rounded flex-1", placeholder: "Model", value: editModel, onChange: e => setEditModel(e.target.value) })] }), _jsx("textarea", { className: "border p-2 rounded w-full font-mono text-sm", rows: 8, value: editContent, onChange: e => setEditContent(e.target.value) }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: () => handleUpdate(agent.name), className: "bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700", children: "Save" }), _jsx("button", { onClick: () => setEditingId(null), className: "bg-gray-500 text-white px-3 py-1 rounded text-sm hover:bg-gray-600", children: "Cancel" })] })] })) : (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsxs("div", { children: [_jsx("span", { className: "font-semibold text-lg", children: agent.name }), _jsx("span", { className: `ml-2 text-xs px-2 py-0.5 rounded ${agent.mode === 'primary' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`, children: agent.mode }), _jsx("span", { className: `ml-2 text-xs px-2 py-0.5 rounded ${agent.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}`, children: agent.enabled ? 'Enabled' : 'Disabled' })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: (e) => { e.stopPropagation(); handleToggle(agent); }, className: `px-3 py-1 rounded text-sm text-white ${agent.enabled ? 'bg-gray-500 hover:bg-gray-600' : 'bg-green-500 hover:bg-green-600'}`, children: agent.enabled ? 'Disable' : 'Enable' }), _jsx("button", { onClick: (e) => { e.stopPropagation(); startEdit(agent); }, className: "bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700", children: "Edit" }), _jsx("button", { onClick: (e) => { e.stopPropagation(); handleDelete(agent.name); }, className: "bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700", children: "Delete" })] })] }), agent.description && _jsx("p", { className: "text-sm text-gray-600 mb-2", children: agent.description }), agent.model && _jsxs("p", { className: "text-xs text-gray-400", children: ["Model: ", agent.model] }), _jsxs("details", { className: "mt-2", children: [_jsx("summary", { className: "text-xs text-gray-500 cursor-pointer hover:text-gray-700", children: "Preview content" }), _jsxs("pre", { className: "mt-2 text-xs bg-gray-50 p-2 rounded overflow-x-auto max-h-32 overflow-y-auto", children: [agent.content.substring(0, 500), agent.content.length > 500 ? '...' : ''] })] })] })) }, agent.id))) })] }, group.category))), _jsx(Overlay, { isOpen: selectedAgent !== null, onClose: () => setSelectedAgent(null), title: selectedAgent?.name ?? "", subtitle: selectedAgent?.description, children: selectedAgent && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "grid grid-cols-2 gap-4 text-sm", children: [_jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Category:" }), " ", _jsx("span", { className: "text-gray-600", children: selectedAgent.category })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Mode:" }), " ", _jsx("span", { className: "text-gray-600", children: selectedAgent.mode })] }), selectedAgent.model && _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Model:" }), " ", _jsx("span", { className: "text-gray-600", children: selectedAgent.model })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Enabled:" }), " ", _jsx("span", { className: selectedAgent.enabled ? "text-green-600" : "text-red-600", children: selectedAgent.enabled ? "Yes" : "No" })] })] }), _jsx(MarkdownViewer, { content: selectedAgent.content, isMarkdown: true })] })) })] }));
}
