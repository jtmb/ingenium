"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const dynamic = "force-dynamic";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api } from "../../lib/api";
// ── Constants ────────────────────────────────────────────────────────────
const MAX_ENTRIES = 500;
const POLL_MS = 2_000;
const ALL_LEVELS = ["debug", "info", "warn", "error"];
// ── Color maps ───────────────────────────────────────────────────────────
const SOURCE_BADGE = {
    agent: "bg-blue-50 text-blue-700 border-blue-200",
    plugin: "bg-green-50 text-green-700 border-green-200",
    scheduler: "bg-purple-50 text-purple-700 border-purple-200",
    observer: "bg-cyan-50 text-cyan-700 border-cyan-200",
    "auto-observer": "bg-pink-50 text-pink-700 border-pink-200",
    synthesis: "bg-orange-50 text-orange-700 border-orange-200",
    api: "bg-gray-50 text-gray-600 border-gray-200",
    configs: "bg-teal-50 text-teal-700 border-teal-200",
    skills: "bg-slate-50 text-slate-700 border-slate-200",
    email: "bg-indigo-50 text-indigo-700 border-indigo-200",
};
const LEVEL_DOT = {
    debug: "bg-gray-400",
    info: "bg-blue-500",
    warn: "bg-amber-500",
    error: "bg-red-500",
};
const LEVEL_BADGE = {
    debug: "bg-gray-100 text-gray-600 border-gray-300",
    info: "bg-blue-50 text-blue-700 border-blue-200",
    warn: "bg-amber-50 text-amber-700 border-amber-200",
    error: "bg-red-50 text-red-700 border-red-200",
};
const SOURCE_LABEL = {
    agent: "Agent",
    plugin: "Plugin",
    scheduler: "Scheduler",
    observer: "Observer",
    "auto-observer": "Auto-Observer",
    synthesis: "Synthesis",
    api: "API",
    configs: "Configs",
    skills: "Skills",
    email: "Email",
};
// ── Helpers ──────────────────────────────────────────────────────────────
function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-GB", { hour12: false });
}
function fmtFull(iso) {
    return new Date(iso).toLocaleString();
}
function dedupeKey(e) {
    return `${e.timestamp}|${e.source}|${e.level}|${e.message}`;
}
// ── Page ─────────────────────────────────────────────────────────────────
export default function LogsPage() {
    const project = useProject();
    const [entries, setEntries] = useState([]);
    const [sources, setSources] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    // Filters
    const [selectedSources, setSelectedSources] = useState(new Set(["all"]));
    const [selectedLevels, setSelectedLevels] = useState(new Set(["info", "warn", "error"]));
    const [searchText, setSearchText] = useState("");
    // UI state
    const [paused, setPaused] = useState(false);
    const [lastUpdate, setLastUpdate] = useState(null);
    const intervalRef = useRef(null);
    const scrollRef = useRef(null);
    const shouldAutoScroll = useRef(true);
    const seenKeys = useRef(new Set());
    const lastTimestampRef = useRef("");
    // ── Fetch ──────────────────────────────────────────────────────────────
    const fetchLogs = useCallback(() => {
        api.logs
            .list(project, lastTimestampRef.current || undefined, 200)
            .then((r) => {
            const data = r.data || r;
            const newEntries = data.entries || [];
            const newSources = data.sources || [];
            if (newEntries.length > 0) {
                // Deduplicate using seenKeys
                const unseen = newEntries.filter((e) => {
                    const key = dedupeKey(e);
                    if (seenKeys.current.has(key))
                        return false;
                    seenKeys.current.add(key);
                    return true;
                });
                if (unseen.length > 0) {
                    setEntries((prev) => {
                        const merged = [...prev, ...unseen];
                        // Enforce MAX_ENTRIES limit
                        return merged.length > MAX_ENTRIES
                            ? merged.slice(merged.length - MAX_ENTRIES)
                            : merged;
                    });
                    // Update last timestamp for `since` pagination
                    const latest = unseen[unseen.length - 1];
                    lastTimestampRef.current = latest.timestamp;
                }
            }
            setSources(newSources);
            setTotal(data.total ?? 0);
            setLastUpdate(new Date().toISOString());
            setError(null);
            setLoading(false);
        })
            .catch((err) => {
            setError(err.message || "Failed to fetch logs");
            setLoading(false);
        });
    }, [project]);
    // Initial fetch
    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);
    // ── Polling ────────────────────────────────────────────────────────────
    useEffect(() => {
        if (paused) {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        }
        else {
            intervalRef.current = setInterval(fetchLogs, POLL_MS);
        }
        return () => {
            if (intervalRef.current)
                clearInterval(intervalRef.current);
        };
    }, [paused, fetchLogs]);
    // ── Auto-scroll ────────────────────────────────────────────────────────
    useEffect(() => {
        if (shouldAutoScroll.current && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [entries]);
    const handleScroll = useCallback(() => {
        if (!scrollRef.current)
            return;
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        // If within 4px of bottom, resume auto-scroll; otherwise pause it
        shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 4;
    }, []);
    // ── Filter logic ───────────────────────────────────────────────────────
    const filteredEntries = useMemo(() => {
        const showAllSources = selectedSources.has("all");
        return entries.filter((e) => {
            if (!showAllSources && !selectedSources.has(e.source))
                return false;
            if (!selectedLevels.has(e.level))
                return false;
            if (searchText &&
                !e.message.toLowerCase().includes(searchText.toLowerCase()))
                return false;
            return true;
        });
    }, [entries, selectedSources, selectedLevels, searchText]);
    // Derived stats
    const activeSourcesCount = useMemo(() => new Set(entries.map((e) => e.source)).size, [entries]);
    // ── Toggle helpers ─────────────────────────────────────────────────────
    const toggleSource = (src) => {
        setSelectedSources((prev) => {
            const next = new Set(prev);
            if (src === "all") {
                // Selecting "All" clears individual selections
                return new Set(["all"]);
            }
            // Remove "all" from the set first
            next.delete("all");
            if (next.has(src)) {
                next.delete(src);
                // If nothing left, fall back to "all"
                if (next.size === 0)
                    next.add("all");
            }
            else {
                next.add(src);
            }
            return next;
        });
    };
    const toggleLevel = (lvl) => {
        setSelectedLevels((prev) => {
            const next = new Set(prev);
            if (next.has(lvl)) {
                next.delete(lvl);
            }
            else {
                next.add(lvl);
            }
            return next;
        });
    };
    // ── Render ─────────────────────────────────────────────────────────────
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between flex-wrap gap-3", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-3xl font-bold", children: "System Logs" }), _jsx("p", { className: "text-sm text-gray-400 mt-1", children: "Live log stream from the Ingenium server" })] }), _jsxs("div", { className: "flex items-center gap-4 text-sm text-gray-600", children: [_jsxs("span", { children: ["Total: ", _jsx("strong", { children: total })] }), _jsxs("span", { children: ["Sources:", " ", _jsx("strong", { className: "text-blue-600", children: activeSourcesCount })] }), _jsxs("span", { children: ["Displayed:", " ", _jsx("strong", { className: "text-emerald-600", children: filteredEntries.length })] }), _jsx("span", { className: "text-gray-400", children: lastUpdate ? `Updated ${fmtTime(lastUpdate)}` : "—" }), _jsxs("button", { onClick: () => setPaused((p) => !p), className: `px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${paused
                                    ? "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
                                    : "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100"}`, children: [paused ? "▶ Resume" : "⏸ Paused", " \u2014", " ", paused ? "PAUSED" : "LIVE"] })] })] }), _jsxs("div", { className: "bg-white border rounded p-3 hover:shadow-md transition-shadow space-y-3", children: [_jsxs("div", { className: "flex items-center gap-1.5 flex-wrap", children: [_jsx("span", { className: "text-xs text-gray-400 mr-1 font-medium", children: "Sources:" }), _jsx("button", { onClick: () => toggleSource("all"), className: `px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${selectedSources.has("all")
                                    ? "bg-gray-800 text-white shadow-sm"
                                    : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-100"}`, children: "All" }), sources.map((src) => {
                                const badge = SOURCE_BADGE[src] ?? "bg-gray-50 text-gray-600 border-gray-200";
                                const isSelected = selectedSources.has(src);
                                return (_jsx("button", { onClick: () => toggleSource(src), className: `px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${isSelected
                                        ? `${badge} shadow-sm ring-1 ring-offset-1`
                                        : "bg-white border-gray-200 text-gray-500 hover:bg-gray-100"}`, children: SOURCE_LABEL[src] ?? src }, src));
                            })] }), _jsxs("div", { className: "flex items-center gap-4 flex-wrap", children: [_jsx("span", { className: "text-xs text-gray-400 font-medium", children: "Levels:" }), ALL_LEVELS.map((lvl) => {
                                const isSelected = selectedLevels.has(lvl);
                                const dot = LEVEL_DOT[lvl] ?? "bg-gray-400";
                                return (_jsxs("label", { className: `flex items-center gap-1.5 text-xs cursor-pointer select-none ${isSelected ? "text-gray-800 font-medium" : "text-gray-400"}`, children: [_jsx("input", { type: "checkbox", checked: isSelected, onChange: () => toggleLevel(lvl), className: "sr-only" }), _jsx("span", { className: `w-2.5 h-2.5 rounded-full inline-block ${dot} ${isSelected ? "ring-2 ring-offset-1 ring-gray-300" : "opacity-40"}` }), lvl.toUpperCase()] }, lvl));
                            }), _jsx("div", { className: "flex-1 min-w-[200px]", children: _jsx("input", { type: "text", value: searchText, onChange: (e) => setSearchText(e.target.value), placeholder: "Search messages...", className: "w-full border border-gray-200 rounded text-xs px-3 py-1.5 focus:outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-200" }) })] })] }), loading && entries.length === 0 && (_jsx("div", { className: "bg-gray-50 border rounded p-12 text-center text-gray-400", children: "Loading logs..." })), error && entries.length === 0 && (_jsx("div", { className: "bg-red-50 border border-red-200 rounded p-6 text-center text-red-600 text-sm", children: error })), !loading && !error && filteredEntries.length === 0 && (_jsxs("div", { className: "bg-gray-50 border rounded p-12 text-center text-gray-400", children: [_jsx("p", { className: "text-lg font-medium mb-1", children: "No log entries yet." }), _jsx("p", { className: "text-sm", children: "System is running. Logs will appear here as events occur." })] })), filteredEntries.length > 0 && (_jsx("div", { ref: scrollRef, onScroll: handleScroll, className: "bg-white border rounded overflow-y-auto max-h-[calc(100vh-24rem)] hover:shadow-md transition-shadow", children: _jsxs("table", { className: "w-full text-sm font-mono", children: [_jsx("thead", { className: "sticky top-0 bg-gray-50 border-b border-gray-200 z-10", children: _jsxs("tr", { className: "text-left text-xs text-gray-500 uppercase tracking-wider", children: [_jsx("th", { className: "px-4 py-2 whitespace-nowrap w-[80px]", children: "Time" }), _jsx("th", { className: "px-4 py-2 whitespace-nowrap w-[110px]", children: "Source" }), _jsx("th", { className: "px-4 py-2 whitespace-nowrap w-[60px]", children: "Level" }), _jsx("th", { className: "px-4 py-2", children: "Message" })] }) }), _jsx("tbody", { className: "divide-y divide-gray-100", children: filteredEntries.map((entry, idx) => {
                                const sourceBadge = SOURCE_BADGE[entry.source] ??
                                    "bg-gray-50 text-gray-600 border-gray-200";
                                const levelDot = LEVEL_DOT[entry.level] ?? "bg-gray-400";
                                const levelBadge = LEVEL_BADGE[entry.level] ??
                                    "bg-gray-100 text-gray-600 border-gray-300";
                                return (_jsxs("tr", { className: "hover:bg-gray-50 transition-colors", title: fmtFull(entry.timestamp), children: [_jsx("td", { className: "px-4 py-1.5 text-xs text-gray-400 whitespace-nowrap", children: fmtTime(entry.timestamp) }), _jsx("td", { className: "px-4 py-1.5 whitespace-nowrap", children: _jsx("span", { className: `text-xs px-2 py-0.5 rounded border ${sourceBadge}`, children: SOURCE_LABEL[entry.source] ?? entry.source }) }), _jsx("td", { className: "px-4 py-1.5 whitespace-nowrap", children: _jsxs("span", { className: `inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border ${levelBadge}`, children: [_jsx("span", { className: `w-1.5 h-1.5 rounded-full ${levelDot}` }), entry.level.toUpperCase()] }) }), _jsx("td", { className: "px-4 py-1.5 text-xs text-gray-700 break-all", children: entry.message })] }, `${entry.timestamp}-${idx}`));
                            }) })] }) }))] }));
}
