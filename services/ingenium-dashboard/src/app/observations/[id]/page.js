"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useProject } from "../../../lib/ProjectContext";
import { api } from "../../../lib/api";
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
export default function ObservationDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const project = useProject();
    const [observation, setObservation] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        const numericId = parseInt(id);
        if (isNaN(numericId)) {
            setError("Invalid observation ID");
            return;
        }
        api.observations
            .get(numericId, project)
            .then((r) => setObservation(r.data))
            .catch((err) => setError(err.message ?? "Failed to load observation"));
    }, [id, project]);
    if (error) {
        return (_jsxs("div", { className: "text-center py-20", children: [_jsx("h1", { className: "text-4xl font-bold text-gray-400", children: "404" }), _jsx("p", { className: "text-gray-500 mt-2", children: "Observation not found" }), _jsx("button", { onClick: () => router.push("/observations"), className: "mt-4 text-blue-600 hover:underline", children: "Back to observations" })] }));
    }
    if (!observation) {
        return (_jsxs("div", { className: "text-center py-20", children: [_jsx("div", { className: "animate-spin h-8 w-8 border-2 border-gray-300 border-t-blue-600 rounded-full mx-auto" }), _jsx("p", { className: "text-gray-500 mt-4", children: "Loading observation..." })] }));
    }
    const parsedContext = safeParseJson(observation.context);
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex justify-between items-center", children: [_jsxs("h1", { className: "text-3xl font-bold", children: ["Observation #", observation.id] }), _jsx("button", { onClick: () => router.push("/observations"), className: "text-sm text-gray-500 hover:text-gray-700", children: "\u2190 Back to list" })] }), _jsxs("div", { className: "bg-white p-6 rounded border shadow-sm space-y-6", children: [_jsxs("div", { className: "grid grid-cols-2 md:grid-cols-3 gap-4 text-sm", children: [_jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Type:" }), " ", _jsx("span", { className: `inline-block px-2 py-0.5 rounded text-xs ${TYPE_COLORS[observation.observation_type] || ""}`, children: observation.observation_type })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Status:" }), " ", _jsx("span", { className: `inline-block px-2 py-0.5 rounded text-xs ${STATUS_COLORS[observation.status] || ""}`, children: observation.status })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Importance:" }), " ", _jsxs("span", { className: "text-gray-600", children: [observation.importance ?? 5, "/10"] })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Source:" }), " ", _jsx("span", { className: "text-gray-600", children: observation.source || "agent" })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Created:" }), " ", _jsx("span", { className: "text-gray-600", children: new Date(observation.created_at).toLocaleString() })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Project:" }), " ", _jsx("span", { className: "text-gray-600", children: observation.project_id })] })] }), _jsxs("div", { children: [_jsx("h3", { className: "font-semibold mb-2", children: "Content" }), _jsx("pre", { className: "bg-gray-50 p-4 rounded border overflow-x-auto text-sm font-mono whitespace-pre-wrap", children: observation.content })] }), observation.context && (_jsxs("div", { children: [_jsx("h3", { className: "font-semibold mb-2", children: "Context" }), parsedContext ? (_jsx("pre", { className: "bg-gray-50 p-4 rounded border overflow-x-auto text-xs font-mono", children: JSON.stringify(parsedContext, null, 2) })) : (_jsx("pre", { className: "bg-gray-50 p-4 rounded border overflow-x-auto text-xs font-mono whitespace-pre-wrap text-gray-600", children: observation.context }))] }))] })] }));
}
