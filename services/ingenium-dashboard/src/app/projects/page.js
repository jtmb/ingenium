"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import Overlay from "../components/Overlay";
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
export default function ProjectsPage() {
    const [projects, setProjects] = useState([]);
    const [archived, setArchived] = useState([]);
    const [name, setName] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [view, setView] = useState("active");
    const [details, setDetails] = useState({});
    const [expanded, setExpanded] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(null);
    const [showCreate, setShowCreate] = useState(false);
    const load = () => {
        api.projects.list().then((r) => setProjects(r.data)).catch(() => { });
        api.projects.listArchived().then((r) => setArchived(r.data)).catch(() => { });
    };
    useEffect(() => { load(); }, []);
    // Fetch details for all active projects
    useEffect(() => {
        for (const p of projects) {
            api.projects.detail(p.name).then((r) => {
                setDetails((prev) => ({ ...prev, [p.name]: r.data }));
            }).catch(() => { });
        }
    }, [projects]);
    const create = async () => {
        if (!name)
            return;
        await api.projects.create(name);
        setName("");
        load();
    };
    const archive = async (n) => { await api.projects.archive(n); load(); };
    const restore = async (n) => { await api.projects.restore(n); load(); };
    const rename = async (oldName) => {
        const newName = prompt("New name:", oldName);
        if (newName && newName !== oldName) {
            await api.projects.update(oldName, newName);
            load();
        }
    };
    const handleDelete = async (name) => {
        try {
            await api.projects.purgeOne(name);
            setConfirmDelete(null);
            load();
        }
        catch {
            alert("Failed to delete project");
            setConfirmDelete(null);
        }
    };
    const activeProjects = projects.filter(p => !p.archived_at);
    const displayed = (view === "active" ? activeProjects : archived)
        .filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()));
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h1", { className: "text-3xl font-bold", children: "Projects" }), _jsx("button", { onClick: () => setShowCreate(true), className: "bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700", children: "+ New Project" })] }), _jsxs("div", { className: "flex gap-2 justify-between items-center", children: [_jsxs("div", { className: "flex gap-2 items-center", children: [_jsx("button", { onClick: () => setView("active"), className: `px-3 py-1 rounded text-sm font-medium ${view === "active" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`, children: "Active" }), _jsx("button", { onClick: () => setView("archived"), className: `px-3 py-1 rounded text-sm font-medium ${view === "archived" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`, children: "Archived" })] }), _jsx("input", { value: searchQuery, onChange: (e) => setSearchQuery(e.target.value), placeholder: "Search projects...", className: "border border-gray-200 p-2 rounded text-sm w-64" })] }), _jsxs("div", { className: "space-y-3", children: [displayed.map((p) => {
                        const d = details[p.name];
                        const synth = d?.latest_synthesis;
                        const synthCount = synth ? formatRelative(synth) : "—";
                        return (_jsxs("div", { onClick: () => setExpanded(expanded === p.name ? null : p.name), className: "bg-white rounded border overflow-hidden hover:shadow-md transition-shadow cursor-pointer", children: [_jsxs("div", { className: "px-5 py-4 border-b border-gray-100 flex items-center justify-between", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-lg font-semibold", children: p.name }), !!p.is_global && _jsx("span", { className: "text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium", children: "GLOBAL" }), p.archived_at && _jsx("span", { className: "text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded font-medium", children: "ARCHIVED" })] }), _jsxs("div", { className: "text-xs text-gray-400 mt-0.5", children: ["Created ", formatRelative(p.created_at)] })] }), _jsxs("div", { className: "flex gap-2", children: [view === "active" && (_jsxs(_Fragment, { children: [_jsx("button", { onClick: (e) => { e.stopPropagation(); rename(p.name); }, className: "text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50 text-gray-600", children: "Rename" }), _jsx("button", { onClick: (e) => { e.stopPropagation(); archive(p.name); }, className: "text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-red-50 text-red-600", children: "Archive" })] })), view === "archived" && (_jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: (e) => { e.stopPropagation(); restore(p.name); }, className: "text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-green-50 text-green-600", children: "Restore" }), _jsx("button", { onClick: (e) => { e.stopPropagation(); setConfirmDelete(p.name); }, className: "text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-red-50 text-red-600", children: "Delete" })] })), _jsx("button", { onClick: (e) => { e.stopPropagation(); setExpanded(expanded === p.name ? null : p.name); }, className: "text-xs px-3 py-1.5 bg-gray-50 hover:bg-gray-100 rounded text-gray-600 font-medium", children: expanded === p.name ? "Collapse" : "Detail ▸" })] })] }), _jsxs("div", { className: "px-5 py-3 flex gap-6 text-sm", children: [_jsxs("div", { className: "text-gray-500", children: [_jsx("span", { className: "font-semibold text-gray-800", children: d?.skills_count ?? "..." }), " Skills"] }), _jsxs("div", { className: "text-gray-500", children: [_jsx("span", { className: "font-semibold text-gray-800", children: d?.observation_stats?.total ?? "..." }), " Observations", d?.observation_stats?.pending > 0 && _jsxs("span", { className: "text-amber-500 ml-1", children: ["(", d.observation_stats.pending, " pending)"] })] }), _jsxs("div", { className: "text-gray-500", children: [_jsx("span", { className: "font-semibold text-gray-800", children: d?.pipeline?.length ?? "..." }), " Pipeline events"] }), _jsxs("div", { className: "text-gray-500", children: [_jsx("span", { className: "text-gray-400", children: "Last synthesis:" }), " ", _jsx("span", { className: "font-medium text-gray-700", children: synthCount })] }), _jsx("div", { className: "flex-1" }), p.path && _jsx("div", { className: "text-xs text-gray-400 truncate max-w-[200px]", title: p.path, children: p.path })] }), expanded === p.name && d && (_jsx("div", { className: "border-t border-gray-100 px-5 py-4 bg-gray-50", children: _jsxs("div", { className: "grid grid-cols-2 gap-6", children: [_jsxs("div", { children: [_jsx("h3", { className: "font-semibold text-sm mb-2 text-gray-700", children: "Recent Skills" }), d.recent_skills?.length > 0 ? (_jsx("div", { className: "space-y-1", children: d.recent_skills.slice(0, 5).map((s) => (_jsxs("div", { className: "text-sm flex justify-between", children: [_jsx("span", { className: "text-blue-600", children: s.name }), _jsx("span", { className: "text-xs text-gray-400", children: formatRelative(s.created_at) })] }, s.name))) })) : _jsx("p", { className: "text-xs text-gray-400", children: "No skills yet." })] }), _jsxs("div", { children: [_jsx("h3", { className: "font-semibold text-sm mb-2 text-gray-700", children: "Recent Observations" }), d.observation_stats?.recent?.length > 0 ? (_jsx("div", { className: "space-y-1", children: d.observation_stats.recent.slice(0, 5).map((o, i) => (_jsxs("div", { className: "text-xs flex justify-between", children: [_jsx("span", { className: "text-gray-600 truncate max-w-[200px]", children: o.content?.substring(0, 80) }), _jsx("span", { className: "text-gray-400 ml-2", children: formatRelative(o.created_at) })] }, i))) })) : _jsx("p", { className: "text-xs text-gray-400", children: "No observations yet." })] }), _jsxs("div", { className: "col-span-2", children: [_jsx("h3", { className: "font-semibold text-sm mb-2 text-gray-700", children: "Recent Pipeline Activity" }), d.pipeline?.length > 0 ? (_jsx("div", { className: "space-y-1", children: d.pipeline.map((e) => (_jsxs("div", { className: "text-xs flex gap-3", children: [_jsx("span", { className: `px-1.5 py-0.5 rounded text-[10px] font-medium ${e.event_type?.startsWith("synthesis") ? "bg-emerald-100 text-emerald-700" :
                                                                        e.event_type?.startsWith("trait") ? "bg-blue-100 text-blue-700" :
                                                                            e.event_type?.startsWith("obs") ? "bg-amber-100 text-amber-700" :
                                                                                "bg-gray-100 text-gray-600"}`, children: e.event_type }), _jsx("span", { className: "text-gray-600 flex-1", children: e.title }), _jsx("span", { className: "text-gray-400", children: formatRelative(e.created_at) })] }, e.created_at))) })) : _jsx("p", { className: "text-xs text-gray-400", children: "No pipeline events." })] })] }) }))] }, p.id));
                    }), displayed.length === 0 && _jsxs("p", { className: "text-gray-400 py-8 text-center", children: ["No ", view, " projects."] })] }), showCreate && (_jsx("div", { className: "fixed inset-0 bg-black/50 z-50 flex items-center justify-center", onClick: () => setShowCreate(false), children: _jsxs("div", { className: "bg-white p-6 rounded-lg shadow-xl w-96", onClick: (e) => e.stopPropagation(), children: [_jsx("h3", { className: "text-lg font-semibold mb-4", children: "New Project" }), _jsx("input", { value: name, onChange: (e) => setName(e.target.value), placeholder: "Project name", className: "border border-gray-200 p-2 rounded text-sm w-full mb-3", autoFocus: true }), _jsxs("div", { className: "flex gap-2 justify-end", children: [_jsx("button", { onClick: () => setShowCreate(false), className: "px-3 py-1.5 rounded border border-gray-200 text-sm text-gray-600", children: "Cancel" }), _jsx("button", { onClick: () => { create(); setShowCreate(false); }, disabled: !name, className: "bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50", children: "Create" })] })] }) })), _jsx(Overlay, { isOpen: confirmDelete !== null, onClose: () => setConfirmDelete(null), title: "Delete Project", subtitle: "This action cannot be undone.", children: confirmDelete && (_jsxs("div", { className: "space-y-4", children: [_jsxs("p", { className: "text-sm text-gray-600", children: ["Are you sure you want to permanently delete ", _jsx("strong", { children: confirmDelete }), "? All skills, observations, pipeline events, and settings for this project will be permanently removed."] }), _jsxs("div", { className: "flex gap-2 justify-end", children: [_jsx("button", { onClick: () => setConfirmDelete(null), className: "px-4 py-2 border border-gray-200 rounded text-sm hover:bg-gray-50", children: "Cancel" }), _jsx("button", { onClick: () => handleDelete(confirmDelete), className: "px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700", children: "Delete" })] })] })) })] }));
}
