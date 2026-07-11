"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api } from "../../lib/api";
export default function ConfigPage() {
    const project = useProject();
    const [tab, setTab] = useState("project");
    const [content, setContent] = useState("");
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);
    // Load config on tab or project change
    useEffect(() => {
        api.configs.get(tab, project)
            .then((r) => setContent(JSON.stringify(r.data?.content ? JSON.parse(r.data.content) : {}, null, 2)))
            .catch(() => setContent("{}"));
        setMessage(null);
    }, [tab, project]);
    const syncFromDisk = async () => {
        try {
            setMessage({ type: "success", text: "Syncing from disk..." });
            const r = await api.configs.sync(tab, project);
            const parsed = r.data?.content ? JSON.parse(r.data.content) : {};
            setContent(JSON.stringify(parsed, null, 2));
            setMessage({ type: "success", text: "Synced from disk." });
        }
        catch (e) {
            setMessage({ type: "error", text: `Sync failed: ${e.message}` });
        }
    };
    const save = async () => {
        setSaving(true);
        setMessage(null);
        try {
            await api.configs.set(tab, content, project);
            setMessage({ type: "success", text: "Config saved." });
        }
        catch (e) {
            setMessage({ type: "error", text: `Save failed: ${e.message}` });
        }
        setSaving(false);
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsx("h1", { className: "text-3xl font-bold", children: "Config" }), _jsxs("div", { className: "flex gap-1 border-b border-gray-200", children: [_jsx("button", { onClick: () => setTab("project"), className: `px-4 py-2 text-sm font-medium rounded-t ${tab === "project" ? "bg-white text-blue-700 border border-b-white border-gray-200 -mb-px" : "text-gray-500 hover:text-gray-700"}`, children: "Project Config" }), _jsx("button", { onClick: () => setTab("global"), className: `px-4 py-2 text-sm font-medium rounded-t ${tab === "global" ? "bg-white text-blue-700 border border-b-white border-gray-200 -mb-px" : "text-gray-500 hover:text-gray-700"}`, children: "Global Config" })] }), _jsxs("div", { className: "bg-white border border-gray-200 rounded p-4 space-y-3", children: [_jsx("div", { className: "text-sm text-gray-500", children: tab === "project" ? "opencode.json" : "opencode.jsonc" }), _jsx("textarea", { value: content, onChange: (e) => setContent(e.target.value), className: "w-full border border-gray-200 rounded p-3 font-mono text-sm leading-relaxed", rows: 24, spellCheck: false }), _jsxs("div", { className: "flex gap-3", children: [_jsx("button", { onClick: syncFromDisk, className: "px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50", children: "Sync from disk" }), _jsx("button", { onClick: save, disabled: saving, className: "bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50", children: saving ? "Saving..." : "Save" })] }), message && (_jsx("div", { className: `text-sm px-3 py-2 rounded ${message.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`, children: message.text }))] })] }));
}
