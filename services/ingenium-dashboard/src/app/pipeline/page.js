"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
export const dynamic = "force-dynamic";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api } from "../../lib/api";
import Overlay from "../components/Overlay";
// ── Color maps ───────────────────────────────────────────────────────────
const SOURCE_DOT = {
    agent: "bg-amber-500",
    plugin: "bg-blue-500",
    synthesis: "bg-emerald-500",
    system: "bg-gray-400",
};
const SOURCE_LINE = {
    agent: "bg-amber-300",
    plugin: "bg-blue-300",
    synthesis: "bg-emerald-300",
    system: "bg-gray-300",
};
const SOURCE_BADGE = {
    agent: "bg-amber-50 text-amber-700 border-amber-200",
    plugin: "bg-blue-50 text-blue-700 border-blue-200",
    synthesis: "bg-emerald-50 text-emerald-700 border-emerald-200",
    system: "bg-gray-50 text-gray-600 border-gray-200",
};
const SOURCE_LABEL = {
    agent: "Agent",
    plugin: "Plugin",
    synthesis: "Synthesis",
    system: "System",
};
const EVENT_ICON = {
    session_created: "\u25CB", // ○
    session_idle: "\u25CC", // ◌
    observation_created: "\u25CF", // ●
    observation_imported: "\u25CE", // ◎
    synthesis_triggered: "\u25C7", // ◇
    synthesis_started: "\u25B6", // ▶
    synthesis_completed: "\u25C6", // ◆
    synthesis_failed: "\u2717", // ✗
    trait_created: "\u25B8", // ▸
    trait_updated: "\u25B9", // ▹
    plugin_initialized: "\u25C7", // ◇
    plugin_error: "\u26A0", // ⚠
};
const EVENT_TYPE_LABEL = {
    session_created: "Session created",
    session_idle: "Session idle",
    observation_created: "Observation",
    observation_imported: "Import",
    synthesis_triggered: "Triggered",
    synthesis_started: "Started",
    synthesis_completed: "Completed",
    synthesis_failed: "Failed",
    trait_created: "Trait created",
    trait_updated: "Trait updated",
    plugin_initialized: "Plugin init",
    plugin_error: "Plugin error",
};
// ── Helpers ──────────────────────────────────────────────────────────────
const WINDOW_MS = 60_000;
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
function fmtAbs(iso) {
    return new Date(iso).toLocaleString();
}
function parseData(raw) {
    if (raw === null || raw === undefined)
        return undefined;
    if (typeof raw === "string") {
        try {
            return JSON.parse(raw);
        }
        catch {
            return raw;
        }
    }
    return raw;
}
// ── Page ─────────────────────────────────────────────────────────────────
export default function PipelinePage() {
    const project = useProject();
    const [events, setEvents] = useState([]);
    const [filterMode, setFilterMode] = useState("all");
    const [selected, setSelected] = useState(null);
    const [paused, setPaused] = useState(false);
    const [expandedGroups, setExpandedGroups] = useState(new Set());
    const intervalRef = useRef(null);
    const [nextRun, setNextRun] = useState("");
    const [intervalMs, setIntervalMs] = useState(900000);
    // Fetch synthesis interval for countdown
    useEffect(() => {
        api.settings.get("synthesis_interval_ms", "global-default").then((r) => {
            const ms = parseInt(r.data?.value, 10);
            if (!isNaN(ms) && ms > 0)
                setIntervalMs(ms);
        }).catch(() => { });
    }, []);
    // Countdown to next synthesis run
    useEffect(() => {
        if (intervalMs <= 0) {
            setNextRun("disabled");
            return;
        }
        const tick = () => {
            // Estimate next run from last synthesis_completed event
            const lastCompleted = events.find(e => e.event_type === "synthesis_completed");
            const lastTs = lastCompleted ? new Date(lastCompleted.created_at).getTime() : Date.now();
            const elapsed = Date.now() - lastTs;
            const remaining = Math.max(0, intervalMs - (elapsed % intervalMs));
            const min = Math.floor(remaining / 60000);
            const sec = Math.floor((remaining % 60000) / 1000);
            setNextRun(`Next run in ${min}:${String(sec).padStart(2, "0")}`);
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [events, intervalMs]);
    // ── Fetch ────────────────────────────────────────────────────────────
    const fetchEvents = useCallback(() => {
        const sourceParam = filterMode === "agent" || filterMode === "plugin" || filterMode === "synthesis"
            ? filterMode
            : undefined;
        api.pipeline
            .events(project, { limit: 500, ...(sourceParam ? { source: sourceParam } : {}) })
            .then((r) => {
            let data = (r.data || []);
            if (filterMode === "trait") {
                data = data.filter((e) => e.event_type === "trait_created" || e.event_type === "trait_updated");
            }
            setEvents(data);
        })
            .catch(() => { });
    }, [project, filterMode]);
    useEffect(() => {
        fetchEvents();
    }, [fetchEvents]);
    // ── Polling ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (paused) {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        }
        else {
            intervalRef.current = setInterval(fetchEvents, 3_000);
        }
        return () => {
            if (intervalRef.current)
                clearInterval(intervalRef.current);
        };
    }, [paused, fetchEvents]);
    // ── Derived state ────────────────────────────────────────────────────
    const stats = useMemo(() => ({
        total: events.length,
        observations: events.filter((e) => e.event_type === "observation_created").length,
        syntheses: events.filter((e) => e.event_type.startsWith("synthesis_")).length,
        traits: events.filter((e) => e.event_type.startsWith("trait_")).length,
        skills: events.filter((e) => {
            if (e.event_type === "trait_created" || e.event_type === "trait_updated") {
                const d = typeof e.data === "string" ? JSON.parse(e.data || "{}") : (e.data || {});
                return d.skill_name || d.via_llm;
            }
            return false;
        }).length,
    }), [events]);
    // Build parent → children map for nested rendering
    const childMap = useMemo(() => {
        const map = new Map();
        for (const e of events) {
            if (e.parent_event_id != null) {
                const arr = map.get(e.parent_event_id) || [];
                arr.push(e);
                map.set(e.parent_event_id, arr);
            }
        }
        return map;
    }, [events]);
    // Collapse observation_created events in 60‑second windows
    const displayItems = useMemo(() => {
        const items = [];
        let i = 0;
        while (i < events.length) {
            const event = events[i];
            if (event.event_type === "observation_created") {
                const ts = new Date(event.created_at).getTime();
                const key = `${event.event_source}_${Math.floor(ts / WINDOW_MS)}`;
                const group = [];
                let j = i;
                while (j < events.length) {
                    const e = events[j];
                    if (e.event_type !== "observation_created")
                        break;
                    const eTs = new Date(e.created_at).getTime();
                    if (`${e.event_source}_${Math.floor(eTs / WINDOW_MS)}` === key) {
                        group.push(e);
                        j++;
                    }
                    else {
                        break;
                    }
                }
                if (group.length > 1) {
                    items.push({
                        kind: "collapsed",
                        group: { events: group, windowKey: key, source: event.event_source, firstTs: event.created_at },
                    });
                }
                else {
                    items.push({ kind: "single", event });
                }
                i = j;
            }
            else {
                items.push({ kind: "single", event });
                i++;
            }
        }
        return items;
    }, [events]);
    // ── Helpers ──────────────────────────────────────────────────────────
    const toggleGroup = (key) => {
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(key))
                next.delete(key);
            else
                next.add(key);
            return next;
        });
    };
    const dotColor = (source) => SOURCE_DOT[source] ?? "bg-gray-400";
    const lineColor = (source) => SOURCE_LINE[source] ?? "bg-gray-300";
    // ── Filter pills ─────────────────────────────────────────────────────
    const FILTERS = [
        { label: "All", mode: "all" },
        { label: "Agent", mode: "agent" },
        { label: "Plugin", mode: "plugin" },
        { label: "Synthesis", mode: "synthesis" },
        { label: "Trait", mode: "trait" },
    ];
    // ── Render ───────────────────────────────────────────────────────────
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex justify-between items-center", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-3xl font-bold", children: "Pipeline Activity" }), _jsx("p", { className: "text-sm text-gray-400 mt-1", children: nextRun })] }), _jsxs("div", { className: "text-sm text-gray-500 space-x-4", children: [_jsxs("span", { children: ["Total: ", _jsx("strong", { children: stats.total })] }), _jsxs("span", { children: ["Observations:", " ", _jsx("strong", { className: "text-amber-600", children: stats.observations })] }), _jsxs("span", { children: ["Syntheses:", " ", _jsx("strong", { className: "text-emerald-600", children: stats.syntheses })] }), _jsxs("span", { children: ["Traits:", " ", _jsx("strong", { className: "text-blue-600", children: stats.traits })] }), _jsxs("span", { children: ["Skills:", " ", _jsx("strong", { className: "text-purple-600", children: stats.skills })] })] })] }), _jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [FILTERS.map((f) => (_jsx("button", { onClick: () => setFilterMode(f.mode), className: `px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${filterMode === f.mode
                            ? "bg-gray-800 text-white shadow-sm"
                            : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-100"}`, children: f.label }, f.mode))), _jsx("div", { className: "flex-1" }), _jsx("button", { onClick: () => setPaused((p) => !p), className: `px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${paused
                            ? "bg-green-50 border-green-300 text-green-700 hover:bg-green-100"
                            : "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"}`, children: paused ? "\u25B6 Resume" : "\u275A\u275A Pause" })] }), events.length === 0 && (_jsx("div", { className: "bg-gray-50 p-8 rounded border text-center text-gray-400", children: "No pipeline events yet. Events are logged automatically during agent interactions." })), events.length > 0 && (_jsxs("div", { className: "relative", children: [_jsx("div", { className: "absolute left-[36px] top-0 bottom-0 w-0.5 bg-gray-200" }), _jsx("div", { className: "space-y-0", children: displayItems.map((item, idx) => {
                            const isLast = idx === displayItems.length - 1;
                            if (item.kind === "collapsed") {
                                const group = item.group;
                                const isExpanded = expandedGroups.has(group.windowKey);
                                return (_jsxs("div", { className: "relative mb-0", children: [_jsx(EventRow, { source: group.source, icon: "\\u25CF", iconLabel: "+N", countBadge: group.events.length, isExpanded: isExpanded, onToggle: () => toggleGroup(group.windowKey), title: `${group.events.length} observations`, description: `${SOURCE_LABEL[group.source] ?? group.source} observed ${group.events.length} times`, timestamp: group.firstTs, sourceLabel: SOURCE_LABEL[group.source] ?? group.source, dotColor: dotColor(group.source), lineColor: lineColor(group.source), isLast: isLast, onClickDetail: () => setSelected({ kind: "batch", events: group.events, label: `${group.events.length} observations` }), children: isExpanded && (_jsx("div", { className: "mt-2 border-l-2 border-dashed border-gray-300 ml-5 pl-4 space-y-2", children: group.events.map((obs) => (_jsxs("div", { className: "bg-white border rounded p-3 cursor-pointer hover:shadow-md transition-shadow", onClick: () => setSelected(obs), children: [_jsxs("div", { className: "flex items-center gap-2 mb-1 flex-wrap", children: [_jsx("span", { className: `text-xs px-2 py-0.5 rounded border ${SOURCE_BADGE[obs.event_source] ?? "bg-gray-50 text-gray-600 border-gray-200"}`, children: SOURCE_LABEL[obs.event_source] ?? obs.event_source }), _jsx("span", { className: "text-xs text-gray-500", children: formatRelative(obs.created_at) }), obs.importance != null && (_jsxs("span", { className: "text-xs text-gray-400", children: ["imp: ", obs.importance] }))] }), _jsx("p", { className: "text-sm text-gray-700", children: obs.title }), obs.description && (_jsx("p", { className: "text-xs text-gray-400 mt-0.5", children: obs.description }))] }, obs.id))) })) }), isExpanded &&
                                            group.events.map((obs) => {
                                                const children = childMap.get(obs.id);
                                                if (!children)
                                                    return null;
                                                return (_jsx("div", { className: "ml-10 pl-6 border-l-2 border-dashed border-gray-300 space-y-0", children: children.map((child) => (_jsx(EventRow, { source: child.event_source, icon: EVENT_ICON[child.event_type] ?? "\u25CB", title: child.title, description: child.description, timestamp: child.created_at, sourceLabel: SOURCE_LABEL[child.event_source] ?? child.event_source, dotColor: dotColor(child.event_source), lineColor: lineColor(child.event_source), isLast: false, isChild: true, onClickDetail: () => setSelected(child) }, child.id))) }, `ch-${obs.id}`));
                                            })] }, group.windowKey));
                            }
                            // ── Single event ─────────────────────────────────────
                            const evt = item.event;
                            const children = childMap.get(evt.id);
                            return (_jsxs("div", { className: "relative mb-0", children: [_jsx(EventRow, { source: evt.event_source, icon: EVENT_ICON[evt.event_type] ?? "\u25CB", title: evt.title, description: evt.description, timestamp: evt.created_at, sourceLabel: SOURCE_LABEL[evt.event_source] ?? evt.event_source, dotColor: dotColor(evt.event_source), lineColor: lineColor(evt.event_source), sessionId: evt.session_id, isLast: isLast && !children, onClickDetail: () => setSelected(evt) }), children && (_jsx("div", { className: "ml-10 pl-6 border-l-2 border-dashed border-gray-300 space-y-0", children: children.map((child) => (_jsx(EventRow, { source: child.event_source, icon: EVENT_ICON[child.event_type] ?? "\u25CB", title: child.title, description: child.description, timestamp: child.created_at, sourceLabel: SOURCE_LABEL[child.event_source] ?? child.event_source, dotColor: dotColor(child.event_source), lineColor: lineColor(child.event_source), isLast: false, isChild: true, onClickDetail: () => setSelected(child) }, child.id))) }))] }, evt.id));
                        }) })] })), _jsxs(Overlay, { isOpen: selected !== null, onClose: () => setSelected(null), title: selected?.kind === "batch"
                    ? selected.label
                    : `Event #${selected?.id ?? ""}`, subtitle: selected?.kind === "batch"
                    ? `${selected.events.length} observations`
                    : selected?.event_type
                        ? `${selected.event_type} \u00B7 ${selected.event_source}`
                        : undefined, children: [selected && selected.kind === "batch" && (_jsxs("div", { className: "space-y-3", children: [_jsxs("p", { className: "text-sm text-gray-500", children: ["Batch of ", selected.events.length, " observations from ", selected.events[0]?.event_source ?? "unknown", "."] }), selected.events.map((obs) => (_jsxs("div", { className: "border rounded p-3 bg-gray-50", children: [_jsxs("div", { className: "flex items-center gap-2 mb-1 flex-wrap", children: [_jsx("span", { className: `text-xs px-2 py-0.5 rounded border ${SOURCE_BADGE[obs.event_source] ?? ""}`, children: obs.event_source }), _jsx("span", { className: "text-xs text-gray-400", children: fmtAbs(obs.created_at) })] }), _jsx("p", { className: "text-sm font-medium", children: obs.title }), obs.description && _jsx("p", { className: "text-xs text-gray-500 mt-0.5", children: obs.description }), _jsxs("div", { className: "grid grid-cols-2 gap-2 mt-2 text-xs text-gray-500", children: [_jsxs("div", { children: ["Importance: ", obs.importance ?? 5, "/10"] }), _jsxs("div", { children: ["Session: ", obs.session_id?.slice(0, 8) ?? "\u2014"] })] }), obs.data != null && (_jsxs("div", { className: "mt-2", children: [_jsx("h3", { className: "text-xs font-semibold mb-1", children: "Raw JSON Data" }), _jsx("pre", { className: "bg-gray-100 p-3 rounded border overflow-x-auto text-xs font-mono whitespace-pre-wrap", children: JSON.stringify(parseData(obs.data), null, 2) })] }))] }, obs.id)))] })), selected && selected.kind !== "batch" && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "grid grid-cols-2 gap-4 text-sm", children: [_jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Type:" }), " ", _jsx("span", { className: "text-gray-600", children: selected.event_type })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Source:" }), " ", _jsx("span", { className: `inline-block px-2 py-0.5 rounded text-xs border ${SOURCE_BADGE[selected.event_source] ?? ""}`, children: selected.event_source })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Importance:" }), " ", _jsxs("span", { className: "text-gray-600", children: [selected.importance ?? 5, "/10"] })] }), _jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: "Session:" }), " ", _jsx("span", { className: "text-gray-600 font-mono text-xs", children: selected.event_source === "synthesis" && !selected.session_id
                                                    ? "Scheduled"
                                                    : selected.session_id?.slice(0, 12) ?? "\u2014" })] }), _jsxs("div", { className: "col-span-2", children: [_jsx("span", { className: "font-semibold", children: "Created:" }), " ", _jsx("span", { className: "text-gray-600", children: fmtAbs(selected.created_at) })] }), selected.parent_event_id != null && (_jsxs("div", { className: "col-span-2", children: [_jsx("span", { className: "font-semibold", children: "Parent Event ID:" }), " ", _jsx("span", { className: "text-gray-600 font-mono", children: selected.parent_event_id })] }))] }), _jsxs("div", { children: [_jsx("h3", { className: "font-semibold mb-1", children: "Title" }), _jsx("p", { className: "text-sm text-gray-700", children: selected.title })] }), selected.description && (_jsxs("div", { children: [_jsx("h3", { className: "font-semibold mb-1", children: "Description" }), _jsx("p", { className: "text-sm text-gray-600", children: selected.description })] })), selected.data != null && (_jsxs("div", { children: [selected.event_type === "synthesis_completed" && (_jsx("div", { className: "space-y-3", children: (() => {
                                            const d = parseData(selected.data);
                                            return (_jsxs(_Fragment, { children: [d?.model && (_jsxs("div", { className: "text-sm text-gray-600", children: [_jsx("span", { className: "font-semibold", children: "Model:" }), " ", d.model, d?.endpoint && _jsxs("span", { className: "text-gray-400", children: [" @ ", d.endpoint] })] })), d?.insights?.length > 0 && (_jsxs("div", { children: [_jsx("h3", { className: "font-semibold text-sm mb-1", children: "LLM Insights:" }), _jsx("ul", { className: "text-sm text-gray-600 space-y-1 border-l-2 border-blue-200 pl-3", children: d.insights.map((i, idx) => (_jsxs("li", { children: ["\u2022 ", i] }, idx))) })] })), d?.skills_created > 0 && (_jsxs("p", { className: "text-sm text-gray-600", children: [_jsx("span", { className: "font-semibold", children: "Skills created:" }), " ", d.skills_created] })), d?.traits_created > 0 && (_jsxs("p", { className: "text-sm text-gray-600", children: [_jsx("span", { className: "font-semibold", children: "Traits created:" }), " ", d.traits_created] })), d?.observation_ids?.length > 0 && (_jsxs("p", { className: "text-sm", children: [_jsx("span", { className: "font-semibold text-gray-600", children: "Referenced:" }), " ", _jsx("a", { href: `/observations?project=${d.project_name || project}`, className: "text-blue-600 underline text-sm", children: "View Observations" })] }))] }));
                                        })() })), selected.event_type === "trait_created" && (() => {
                                        const d = parseData(selected.data);
                                        return d?.skill_name ? (_jsxs("div", { className: "space-y-2", children: [_jsxs("div", { className: "text-sm text-gray-600", children: [_jsx("span", { className: "font-semibold", children: "Skill:" }), " ", _jsx("a", { href: `/skills?project=${d.project_name || project}`, className: "text-blue-600 underline font-medium", children: d.skill_name }), d?.via_llm && _jsx("span", { className: "text-xs text-gray-400 ml-1", children: "via LLM" })] }), d?.model && _jsxs("p", { className: "text-xs text-gray-400", children: ["Model: ", d.model] })] })) : null;
                                    })(), selected.event_type === "trait_created" && (() => {
                                        const d = parseData(selected.data);
                                        return d?.trait_type && !d?.skill_name ? (_jsx("div", { className: "space-y-2", children: _jsxs("div", { className: "text-sm text-gray-600", children: [_jsx("span", { className: "font-semibold", children: "Trait:" }), " ", _jsxs("a", { href: `/personality?project=${d.project_name || project}`, className: "text-blue-600 underline font-medium", children: [d.trait_type, " \u2192 ", d.trait_value?.slice(0, 60)] }), d?.confidence != null && (_jsxs("span", { className: "ml-2 text-xs text-gray-400", children: ["confidence: ", (d.confidence * 100).toFixed(0), "%"] }))] }) })) : null;
                                    })(), selected.event_type === "trait_updated" && (() => {
                                        const d = parseData(selected.data);
                                        return d?.trait_type ? (_jsx("div", { className: "space-y-2", children: _jsxs("div", { className: "text-sm text-gray-600", children: [_jsx("span", { className: "font-semibold", children: "Trait:" }), " ", _jsxs("a", { href: `/personality?project=${d.project_name || project}`, className: "text-blue-600 underline font-medium", children: [d.trait_type, " \u2192 ", d.trait_value?.slice(0, 60)] }), d?.confidence != null && (_jsxs("span", { className: "ml-2 text-xs text-gray-400", children: ["confidence: ", (d.confidence * 100).toFixed(0), "%"] }))] }) })) : null;
                                    })(), selected.event_type !== "synthesis_completed" &&
                                        selected.event_type !== "trait_created" &&
                                        selected.event_type !== "trait_updated" &&
                                        (() => {
                                            const d = parseData(selected.data);
                                            return d != null && Object.keys(d).length > 0 ? (_jsxs("div", { children: [_jsx("h3", { className: "font-semibold mb-1", children: "Raw JSON Data" }), _jsx("pre", { className: "bg-gray-50 p-4 rounded border overflow-x-auto text-xs font-mono whitespace-pre-wrap", children: JSON.stringify(d, null, 2) })] })) : null;
                                        })()] }))] }))] })] }));
}
// ── EventRow sub‑component ──────────────────────────────────────────────
function EventRow({ source, icon, iconLabel, countBadge, isExpanded, onToggle, title, description, timestamp, sourceLabel, dotColor, lineColor, sessionId, isLast = false, isChild = false, onClickDetail, children, }) {
    return (_jsxs("div", { children: [_jsxs("div", { className: "flex", children: [_jsxs("div", { className: "w-[72px] shrink-0 flex flex-col items-center relative", children: [_jsx("div", { className: `w-0.5 flex-1 ${lineColor}` }), _jsx("div", { className: `shrink-0 z-10 flex items-center justify-center rounded-full border-2 border-white ${isChild ? "w-2 h-2" : "w-3 h-3"} ${dotColor} ${countBadge ? "cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-gray-300" : ""}`, onClick: onToggle, title: iconLabel, children: countBadge ? (_jsxs("span", { className: "text-[8px] font-bold text-white leading-none", children: ["+", countBadge] })) : (_jsx("span", { className: `${isChild ? "text-[6px]" : "text-[10px]"} text-white leading-none select-none`, children: icon })) }), _jsx("div", { className: `w-0.5 flex-1 ${isLast ? "bg-transparent" : lineColor}` })] }), _jsx("div", { className: `flex-1 pb-3 ${isChild ? "pb-2" : ""} min-w-0`, children: _jsxs("div", { className: `bg-white rounded-lg border p-3 ${isChild ? "p-2" : "p-3"} ${onClickDetail ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`, onClick: onClickDetail, children: [_jsxs("div", { className: "flex items-center gap-2 mb-1 flex-wrap", children: [_jsx("span", { className: `text-xs px-2 py-0.5 rounded border ${SOURCE_BADGE[source] ?? "bg-gray-50 text-gray-600 border-gray-200"}`, children: sourceLabel }), isExpanded !== undefined && (_jsx("button", { onClick: (e) => { e.stopPropagation(); onToggle?.(); }, className: "text-xs text-blue-600 hover:text-blue-800 font-medium", children: isExpanded ? "Collapse" : `+${countBadge ?? 0} observations` })), _jsx("span", { className: "text-xs text-gray-400 flex-1 text-right", title: fmtAbs(timestamp), children: formatRelative(timestamp) }), sessionId && !countBadge && (_jsx("span", { className: "text-xs text-gray-400 font-mono", children: sessionId.slice(0, 8) }))] }), _jsx("p", { className: `font-semibold text-gray-900 ${isChild ? "text-xs" : "text-sm"}`, children: title }), description && (_jsx("p", { className: `text-gray-500 ${isChild ? "text-xs" : "text-sm"}`, children: description }))] }) })] }), children] }));
}
