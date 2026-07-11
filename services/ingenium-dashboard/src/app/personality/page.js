"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api } from "../../lib/api";
import Overlay from "../components/Overlay";
const TYPE_ICONS = {
    communication_style: "💬",
    code_preference: "💻",
    workflow_pattern: "🔄",
    terminology: "📖",
    priority_signal: "🎯",
    feedback_style: "📝",
    interaction_pattern: "⏰",
    domain_knowledge: "🧠",
    learned_skill: "⚡",
    personality_trait: "🌟",
};
export default function PersonalityPage() {
    const project = useProject();
    const [traits, setTraits] = useState([]);
    const [profile, setProfile] = useState(null);
    const [selectedTrait, setSelectedTrait] = useState(null);
    const [sortMode, setSortMode] = useState("grouped");
    const [showHidden, setShowHidden] = useState(false);
    function formatRelative(iso) {
        const diff = Date.now() - new Date(iso).getTime();
        const sec = Math.abs(Math.floor(diff / 1000));
        if (sec < 60)
            return `${sec}s ago`;
        const min = Math.floor(sec / 60);
        if (min < 60)
            return `${min}m ago`;
        const hrs = Math.floor(min / 60);
        if (hrs < 24)
            return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
    }
    useEffect(() => {
        api.personality.list(project).then((r) => setTraits(r.data || [])).catch(() => { });
        api.personality.profile(project).then((r) => setProfile(r.data || [])).catch(() => { });
    }, [project]);
    const hiddenCount = traits.filter(t => (t.confidence || 0) < 0.3).length;
    const handleDismiss = async (id) => {
        try {
            await api.personality.dismiss(id, project);
            setTraits(prev => prev.map(t => t.id === id ? { ...t, is_active: false } : t));
        }
        catch { }
    };
    const grouped = traits.reduce((acc, t) => {
        (acc[t.trait_type] ??= []).push(t);
        return acc;
    }, {});
    const allHidden = Object.keys(grouped).length > 0 && Object.values(grouped).every((typeTraits) => typeTraits.filter(t => (t.confidence || 0) >= 0.3).length === 0);
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex justify-between items-center", children: [_jsx("h1", { className: "text-3xl font-bold", children: "Personality Profile" }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-sm text-gray-400", children: "Sort:" }), _jsxs("select", { value: sortMode, onChange: (e) => setSortMode(e.target.value), className: "border border-gray-200 rounded px-3 py-1.5 text-sm bg-white text-gray-600 hover:bg-gray-50 cursor-pointer", children: [_jsx("option", { value: "grouped", children: "Grouped by type" }), _jsx("option", { value: "newest", children: "Newest first" })] }), _jsxs("span", { className: "text-sm text-gray-500", children: [traits.filter(t => (t.confidence || 0) >= 0.3).length, " trait(s)", hiddenCount > 0 && (_jsx("button", { onClick: () => setShowHidden(!showHidden), className: "ml-2 text-sm text-blue-600 font-medium hover:underline cursor-pointer", children: showHidden ? "Hide" : `${hiddenCount} hidden` }))] })] })] }), sortMode === "newest" && (_jsx("div", { className: "bg-white rounded border divide-y hover:shadow-md transition-shadow", children: [...traits]
                    .filter(t => showHidden || (t.confidence || 0) >= 0.3)
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .map((t) => (_jsxs("div", { className: "px-4 py-3 cursor-pointer hover:bg-gray-50 flex justify-between items-center", onClick: () => setSelectedTrait(t), children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { children: TYPE_ICONS[t.trait_type] || "📌" }), _jsxs("div", { children: [_jsx("span", { className: "font-medium", children: t.display_label || t.trait_value }), _jsx("span", { className: "text-xs text-gray-400 ml-2 capitalize", children: t.trait_type?.replace(/_/g, " ") })] })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("button", { onClick: (e) => { e.stopPropagation(); handleDismiss(t.id); }, className: "text-gray-300 hover:text-red-500 text-lg leading-none", title: "Dismiss trait", children: "\u00D7" }), _jsx("span", { className: "text-xs text-gray-400", children: formatRelative(t.created_at) }), _jsx("div", { className: "w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden", children: _jsx("div", { className: "h-full bg-blue-500 rounded-full", style: { width: `${(t.confidence || 0) * 100}%` } }) })] })] }, t.id))) })), sortMode === "grouped" && Object.entries(grouped).length === 0 && (_jsx("div", { className: "bg-gray-50 p-8 rounded border text-center text-gray-400", children: "No personality traits learned yet. Traits are generated automatically from observations via the synthesis pipeline." })), sortMode === "grouped" && allHidden && !showHidden && (_jsxs("div", { className: "bg-amber-50 border border-amber-200 rounded p-6 text-center", children: [_jsxs("p", { className: "text-amber-800 font-medium mb-2", children: [Object.keys(grouped).length, " trait type(s) found, but all below the display threshold."] }), _jsx("p", { className: "text-amber-600 text-sm mb-3", children: "Traits need 2+ confirming observations to reach the 0.30 display threshold (confidence \u2265 30%)." }), _jsxs("button", { onClick: () => setShowHidden(true), className: "px-4 py-2 bg-amber-100 text-amber-800 rounded text-sm font-medium hover:bg-amber-200", children: ["Show all (", hiddenCount, " hidden)"] })] })), sortMode === "grouped" && Object.entries(grouped).map(([type, typeTraits]) => {
                const visibleTraits = typeTraits.filter(t => showHidden || (t.confidence || 0) >= 0.3);
                if (visibleTraits.length === 0)
                    return null;
                return (_jsxs("div", { className: "bg-white rounded border overflow-hidden hover:shadow-md transition-shadow", children: [_jsxs("div", { className: "bg-gray-50 px-4 py-2 border-b font-semibold text-sm flex items-center gap-2", children: [_jsx("span", { children: TYPE_ICONS[type] || "📌" }), _jsx("span", { className: "capitalize", children: type.replace(/_/g, " ") })] }), _jsx("div", { className: "divide-y", children: visibleTraits.map((t) => (_jsx("div", { className: "px-4 py-3 cursor-pointer hover:bg-gray-50", onClick: () => setSelectedTrait(t), children: _jsxs("div", { className: "flex justify-between items-center", children: [_jsxs("div", { children: [_jsx("span", { className: "font-medium", children: t.display_label || t.trait_value }), t.exemplar_text && _jsxs("p", { className: "text-xs text-gray-400 mt-0.5", children: ["\"", t.exemplar_text.substring(0, 100), "\""] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: (e) => { e.stopPropagation(); handleDismiss(t.id); }, className: "text-gray-300 hover:text-red-500 text-lg leading-none", title: "Dismiss trait", children: "\u00D7" }), _jsx("div", { className: "w-20 h-2 bg-gray-200 rounded-full overflow-hidden", children: _jsx("div", { className: "h-full bg-blue-500 rounded-full", style: { width: `${(t.confidence || 0) * 100}%` } }) }), _jsxs("span", { className: "text-xs text-gray-500 w-8", children: [Math.round((t.confidence || 0) * 100), "%"] })] })] }) }, t.id))) })] }, type));
            }), _jsx(Overlay, { isOpen: selectedTrait !== null, onClose: () => setSelectedTrait(null), title: selectedTrait?.display_label || selectedTrait?.trait_value || "Trait Detail", subtitle: `${selectedTrait?.trait_type?.replace(/_/g, " ")} — ${Math.round((selectedTrait?.confidence || 0) * 100)}% confidence`, children: selectedTrait && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "grid grid-cols-2 gap-4 text-sm", children: [_jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Type:" }), " ", _jsx("span", { className: "text-gray-600", children: selectedTrait.trait_type })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Value:" }), " ", _jsx("span", { className: "text-gray-600", children: selectedTrait.trait_value })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Confidence:" }), " ", _jsxs("span", { className: "text-gray-600", children: [Math.round((selectedTrait.confidence || 0) * 100), "%"] })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Source:" }), " ", _jsx("span", { className: "text-gray-600", children: selectedTrait.source })] })] }), selectedTrait.exemplar_text && (_jsxs("div", { children: [_jsx("h3", { className: "font-semibold mb-1", children: "Exemplar" }), _jsx("pre", { className: "bg-gray-50 p-4 rounded border text-sm", children: selectedTrait.exemplar_text })] })), selectedTrait.metadata && (_jsxs("div", { children: [_jsx("h3", { className: "font-semibold mb-1", children: "Metadata" }), _jsx("pre", { className: "bg-gray-50 p-4 rounded border text-xs font-mono", children: selectedTrait.metadata })] })), _jsx("div", { className: "flex gap-2 pt-2", children: _jsx("button", { onClick: () => { handleDismiss(selectedTrait.id); setSelectedTrait(null); }, className: "text-sm text-red-500 hover:text-red-700", children: "Dismiss trait" }) })] })) })] }));
}
