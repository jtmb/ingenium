"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "../../lib/ProjectContext";
import { api } from "../../lib/api";
import Overlay from "../components/Overlay";
const TYPE_COLORS = {
    correction: "bg-red-100 text-red-700",
    preference: "bg-purple-100 text-purple-700",
    pattern: "bg-green-100 text-green-700",
    insight: "bg-blue-100 text-blue-700",
    feedback: "bg-yellow-100 text-yellow-700",
    behavior: "bg-orange-100 text-orange-700",
    terminology: "bg-indigo-100 text-indigo-700",
    workflow: "bg-teal-100 text-teal-700",
    error: "bg-red-200 text-red-800",
    goal: "bg-pink-100 text-pink-700",
};
const STATUS_COLORS = {
    pending: "bg-yellow-100 text-yellow-700",
    processed: "bg-green-100 text-green-700",
    skipped: "bg-gray-100 text-gray-500",
    failed: "bg-red-100 text-red-700",
};
function safeParseJson(raw) {
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export default function ObservationsPage() {
    const router = useRouter();
    const project = useProject();
    const [observations, setObservations] = useState([]);
    const [statusFilter, setStatusFilter] = useState("");
    const [typeFilter, setTypeFilter] = useState("");
    const [selected, setSelected] = useState(null);
    const [stats, setStats] = useState({ total: 0, pending: 0 });
    useEffect(() => {
        api.observations.list(project, statusFilter, typeFilter).then((r) => setObservations(r.data || [])).catch(() => { });
        api.observations.stats(project).then((r) => setStats(r.data || { total: 0, pending: 0 })).catch(() => { });
    }, [project, statusFilter, typeFilter]);
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex justify-between items-center", children: [_jsx("h1", { className: "text-3xl font-bold", children: "Observations" }), _jsxs("div", { className: "text-sm text-gray-500 space-x-4", children: [_jsxs("span", { children: ["Total: ", _jsx("strong", { children: stats.total })] }), _jsxs("span", { children: ["Pending: ", _jsx("strong", { className: "text-yellow-600", children: stats.pending })] })] })] }), _jsxs("div", { className: "flex gap-2", children: [_jsxs("select", { value: statusFilter, onChange: (e) => setStatusFilter(e.target.value), className: "border p-2 rounded text-sm hover:bg-gray-50 cursor-pointer", children: [_jsx("option", { value: "", children: "All statuses" }), _jsx("option", { value: "pending", children: "Pending" }), _jsx("option", { value: "processed", children: "Processed" }), _jsx("option", { value: "skipped", children: "Skipped" }), _jsx("option", { value: "failed", children: "Failed" })] }), _jsxs("select", { value: typeFilter, onChange: (e) => setTypeFilter(e.target.value), className: "border p-2 rounded text-sm hover:bg-gray-50 cursor-pointer", children: [_jsx("option", { value: "", children: "All types" }), _jsx("option", { value: "correction", children: "Correction" }), _jsx("option", { value: "preference", children: "Preference" }), _jsx("option", { value: "pattern", children: "Pattern" }), _jsx("option", { value: "insight", children: "Insight" }), _jsx("option", { value: "feedback", children: "Feedback" }), _jsx("option", { value: "behavior", children: "Behavior" }), _jsx("option", { value: "terminology", children: "Terminology" }), _jsx("option", { value: "workflow", children: "Workflow" }), _jsx("option", { value: "error", children: "Error" }), _jsx("option", { value: "goal", children: "Goal" })] })] }), _jsxs("div", { className: "space-y-2", children: [observations.length === 0 && (_jsx("div", { className: "bg-gray-50 p-8 rounded border text-center text-gray-400", children: "No observations yet. The agent will record observations automatically during interactions." })), observations.map((o) => (_jsxs("div", { className: "bg-white p-4 rounded border cursor-pointer hover:shadow-md transition-shadow group", onClick: () => setSelected(o), children: [_jsxs("div", { className: "flex gap-2 items-center mb-1 flex-wrap", children: [_jsx("span", { className: `text-xs px-2 py-0.5 rounded ${TYPE_COLORS[o.observation_type] || "bg-gray-100 text-gray-700"}`, children: o.observation_type }), _jsx("span", { className: `text-xs px-2 py-0.5 rounded ${STATUS_COLORS[o.status] || ""}`, children: o.status }), _jsx("span", { className: "text-xs text-gray-400", children: new Date(o.created_at).toLocaleString() }), o.importance && _jsxs("span", { className: "text-xs text-gray-400", children: ["Importance: ", o.importance, "/10"] }), _jsx("span", { className: "ml-auto opacity-0 group-hover:opacity-100 transition-opacity", children: _jsx("button", { onClick: (e) => {
                                                e.stopPropagation();
                                                router.push(`/observations/${o.id}`);
                                            }, className: "text-xs text-blue-600 hover:text-blue-800 underline", title: "View full details", children: "Open" }) })] }), _jsx("p", { className: "text-sm", children: o.content }), o.context && _jsx("pre", { className: "text-xs text-gray-400 mt-1 truncate", children: o.context })] }, o.id)))] }), _jsx(Overlay, { isOpen: selected !== null, onClose: () => setSelected(null), title: `Observation #${selected?.id ?? ""}`, subtitle: selected?.observation_type ? `Type: ${selected.observation_type}` : undefined, children: selected && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "grid grid-cols-2 gap-4 text-sm", children: [_jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Type:" }), " ", _jsx("span", { className: `inline-block px-2 py-0.5 rounded text-xs ${TYPE_COLORS[selected.observation_type] || ""}`, children: selected.observation_type })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Status:" }), " ", _jsx("span", { className: `inline-block px-2 py-0.5 rounded text-xs ${STATUS_COLORS[selected.status] || ""}`, children: selected.status })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Importance:" }), " ", _jsxs("span", { className: "text-gray-600", children: [selected.importance ?? 5, "/10"] })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Source:" }), " ", _jsx("span", { className: "text-gray-600", children: selected.source || "agent" })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Created:" }), " ", _jsx("span", { className: "text-gray-600", children: new Date(selected.created_at).toLocaleString() })] })] }), _jsxs("div", { children: [_jsx("h3", { className: "font-semibold mb-1", children: "Content" }), _jsx("pre", { className: "bg-gray-50 p-4 rounded border overflow-x-auto text-sm font-mono whitespace-pre-wrap", children: selected.content })] }), selected.context && (_jsxs("div", { children: [_jsx("h3", { className: "font-semibold mb-1", children: "Context" }), (() => {
                                    const parsed = safeParseJson(selected.context);
                                    return parsed ? (_jsx("pre", { className: "bg-gray-50 p-4 rounded border overflow-x-auto text-xs font-mono", children: JSON.stringify(parsed, null, 2) })) : (_jsx("pre", { className: "bg-gray-50 p-4 rounded border overflow-x-auto text-xs font-mono whitespace-pre-wrap text-gray-600", children: selected.context }));
                                })()] }))] })) })] }));
}
