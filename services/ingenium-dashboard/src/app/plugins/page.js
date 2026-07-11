"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const dynamic = "force-dynamic";
import { useState, useEffect, useRef } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api } from "../../lib/api";
import Overlay from "../components/Overlay";
/**
 * Plugin management page.
 * Full CRUD: upload .ts plugin files, edit, enable/disable, delete.
 */
export default function PluginsPage() {
    const project = useProject();
    const [plugins, setPlugins] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState("");
    const [newPath, setNewPath] = useState("");
    const [newContent, setNewContent] = useState("");
    const [editingId, setEditingId] = useState(null);
    const [editPath, setEditPath] = useState("");
    const [editContent, setEditContent] = useState("");
    const [selectedPlugin, setSelectedPlugin] = useState(null);
    const fileInputRef = useRef(null);
    const loadPlugins = async () => {
        setLoading(true);
        setError(null);
        try {
            const r = await api.plugins.list(project);
            setPlugins(r.data);
        }
        catch (e) {
            setError(e.message ?? "Failed to load plugins");
        }
        finally {
            setLoading(false);
        }
    };
    useEffect(() => { loadPlugins(); }, [project]);
    const handleFileUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        const reader = new FileReader();
        reader.onload = (ev) => setNewContent(ev.target?.result);
        reader.readAsText(file);
        if (!newPath)
            setNewPath(file.name);
    };
    const handleCreate = async () => {
        if (!newName || !newPath)
            return;
        try {
            await api.plugins.create(newName, newPath, newContent || undefined, project);
            setNewName("");
            setNewPath("");
            setNewContent("");
            setShowCreate(false);
            if (fileInputRef.current)
                fileInputRef.current.value = "";
            await loadPlugins();
        }
        catch (e) {
            setError(e.message ?? "Failed to create plugin");
        }
    };
    const handleDelete = async (p) => {
        if (!window.confirm(`Delete plugin "${p.name}"? This cannot be undone.`))
            return;
        try {
            await api.plugins.delete(p.name, project);
            await loadPlugins();
        }
        catch (e) {
            setError(e.message ?? "Failed to delete plugin");
        }
    };
    const handleUpdate = async (name) => {
        try {
            await api.plugins.update(name, { file_path: editPath, source_content: editContent }, project);
            setEditingId(null);
            await loadPlugins();
        }
        catch (e) {
            setError(e.message ?? "Failed to update plugin");
        }
    };
    const toggle = async (p) => {
        try {
            if (p.enabled) {
                await api.plugins.disable(p.name, project);
            }
            else {
                await api.plugins.enable(p.name, project);
            }
            setPlugins(plugins.map((x) => x.id === p.id ? { ...x, enabled: !x.enabled } : x));
        }
        catch (e) {
            setError(e.message ?? "Failed to toggle plugin");
        }
    };
    if (loading) {
        return (_jsxs("div", { className: "space-y-8", children: [_jsx("h1", { className: "text-3xl font-bold", children: "Plugins" }), _jsx("p", { className: "text-gray-500", children: "Loading plugins..." })] }));
    }
    if (error) {
        return (_jsxs("div", { className: "space-y-8", children: [_jsx("h1", { className: "text-3xl font-bold", children: "Plugins" }), _jsx("p", { className: "text-red-500", children: error }), _jsx("button", { onClick: loadPlugins, className: "bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition-colors", children: "Retry" })] }));
    }
    return (_jsxs("div", { className: "space-y-8", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h1", { className: "text-3xl font-bold", children: "Plugins" }), _jsx("button", { onClick: () => setShowCreate(!showCreate), className: "bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition-colors", children: showCreate ? "Cancel" : "Add Plugin" })] }), showCreate && (_jsx("div", { className: "bg-white p-4 rounded border hover:shadow-md transition-shadow", children: _jsxs("div", { className: "flex flex-row gap-2 items-end flex-wrap", children: [_jsxs("div", { className: "flex flex-col", children: [_jsx("label", { className: "text-xs text-gray-500 mb-1", children: "Name" }), _jsx("input", { value: newName, onChange: (e) => setNewName(e.target.value), placeholder: "my-plugin", className: "border rounded px-3 py-2 text-sm" })] }), _jsxs("div", { className: "flex flex-col", children: [_jsx("label", { className: "text-xs text-gray-500 mb-1", children: "File Path" }), _jsx("input", { value: newPath, onChange: (e) => setNewPath(e.target.value), placeholder: "my-plugin.ts", className: "border rounded px-3 py-2 text-sm" })] }), _jsxs("div", { className: "flex flex-col", children: [_jsx("label", { className: "text-xs text-gray-500 mb-1", children: "File (.ts)" }), _jsx("input", { ref: fileInputRef, type: "file", accept: ".ts,.js", onChange: handleFileUpload, className: "text-sm" })] }), _jsx("button", { onClick: handleCreate, className: "bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed", disabled: !newName || !newPath, children: "Upload & Create" })] }) })), plugins.length === 0 ? (_jsx("p", { className: "text-gray-500", children: "No plugins registered. Click \"Add Plugin\" to upload one." })) : (_jsx("div", { className: "space-y-3", children: plugins.map((p) => editingId === p.id ? (_jsxs("div", { className: "bg-white p-4 rounded border space-y-3 hover:shadow-md transition-shadow", children: [_jsx("input", { value: editPath, onChange: (e) => setEditPath(e.target.value), placeholder: "plugin.ts", className: "w-full border rounded px-3 py-2 text-sm" }), _jsx("textarea", { value: editContent, onChange: (e) => setEditContent(e.target.value), rows: 10, className: "w-full border rounded px-3 py-2 text-sm font-mono" }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: () => handleUpdate(p.name), className: "bg-blue-600 text-white py-2 px-4 rounded text-sm hover:bg-blue-700 transition-colors", children: "Save" }), _jsx("button", { onClick: () => setEditingId(null), className: "bg-gray-200 text-gray-700 py-2 px-4 rounded text-sm hover:bg-gray-300 transition-colors", children: "Cancel" })] })] }, p.id)) : (_jsxs("div", { className: "bg-white p-4 rounded border hover:shadow-md transition-shadow flex flex-col gap-2 cursor-pointer", onClick: () => setSelectedPlugin(p), children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("span", { className: "font-medium", children: p.name }), _jsx("span", { className: "text-sm text-gray-500 ml-2", children: p.file_path })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: async (e) => {
                                                e.stopPropagation();
                                                let content = p.source_content || "";
                                                if (!content) {
                                                    try {
                                                        const res = await api.plugins.getSource(p.name, project);
                                                        content = res.data.source;
                                                    }
                                                    catch { /* keep empty */ }
                                                }
                                                setEditingId(p.id);
                                                setEditPath(p.file_path);
                                                setEditContent(content);
                                            }, className: "bg-gray-100 text-gray-600 py-1 px-3 rounded text-sm hover:bg-gray-200 transition-colors", children: "Edit" }), _jsx("button", { onClick: (e) => { e.stopPropagation(); toggle(p); }, className: `py-1 px-3 rounded text-sm transition-colors ${p.enabled
                                                ? "bg-green-100 text-green-700 hover:bg-green-200"
                                                : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`, children: p.enabled ? "Enabled" : "Disabled" }), _jsx("button", { onClick: (e) => { e.stopPropagation(); handleDelete(p); }, className: "bg-red-600 text-white py-1 px-3 rounded text-sm hover:bg-red-700 transition-colors", children: "Delete" })] })] }), p.source_content && (_jsxs("pre", { className: "text-xs text-gray-400 font-mono truncate bg-gray-50 p-2 rounded", children: [p.source_content.slice(0, 120), p.source_content.length > 120 ? "..." : ""] }))] }, p.id))) })), _jsx(Overlay, { isOpen: selectedPlugin !== null, onClose: () => setSelectedPlugin(null), title: selectedPlugin?.name ?? "", subtitle: selectedPlugin?.file_path, children: selectedPlugin && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "text-sm text-gray-600", children: [_jsx("span", { className: "font-semibold", children: "Enabled:" }), " ", _jsx("span", { className: selectedPlugin.enabled ? "text-green-600" : "text-red-600", children: selectedPlugin.enabled ? "Yes" : "No" })] }), selectedPlugin.source_content && (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-2 border-b border-gray-200 pb-2 mb-2", children: [_jsx("span", { className: "px-3 py-1 text-sm rounded bg-gray-200 text-gray-400 cursor-not-allowed", children: "Preview" }), _jsx("span", { className: "px-3 py-1 text-sm rounded bg-blue-600 text-white", children: "Source" }), _jsx("span", { className: "text-xs text-gray-400 ml-auto", children: "Source code \u2014 not markdown" })] }), _jsx("pre", { className: "bg-gray-50 p-4 rounded border overflow-x-auto text-sm font-mono whitespace-pre-wrap", children: selectedPlugin.source_content })] }))] })) })] }));
}
