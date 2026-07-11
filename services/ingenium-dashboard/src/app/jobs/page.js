"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const dynamic = "force-dynamic";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api } from "../../lib/api";
/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
/** Map a cron string to a human-readable description. */
function cronToHuman(cron) {
    if (!cron)
        return "";
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5)
        return cron;
    const [min, hour, dayOfMonth, , dayOfWeek] = parts;
    // Special cases
    if (cron === "* * * * *")
        return "every minute";
    if (cron === "0 * * * *")
        return "hourly";
    if (cron === "0 0 * * *")
        return "daily at midnight";
    if (cron === "0 0 * * 0")
        return "weekly on Sunday";
    if (cron === "0 0 1 * *")
        return "monthly on the 1st";
    // */N patterns
    const minMatch = min?.match(/^\*\/(\d+)$/);
    const hourMatch = hour?.match(/^\*\/(\d+)$/);
    if (minMatch && hour === "*" && dayOfMonth === "*" && dayOfWeek === "*") {
        return `every ${minMatch[1]} min`;
    }
    if (min === "0" && hourMatch && dayOfMonth === "*" && dayOfWeek === "*") {
        return `every ${hourMatch[1]} hours`;
    }
    // Specific time
    if (min?.match(/^\d+$/) && hour?.match(/^\d+$/) && dayOfMonth === "*" && dayOfWeek === "*") {
        const h = parseInt(hour, 10);
        const m = parseInt(min, 10);
        const ampm = h >= 12 ? "PM" : "AM";
        const h12 = h % 12 || 12;
        return `daily at ${h12}:${String(m).padStart(2, "0")} ${ampm}`;
    }
    return cron;
}
/** Return a duration string between two ISO datetimes. */
function duration(started, finished) {
    if (!started)
        return "—";
    const end = finished ? new Date(finished).getTime() : Date.now();
    const ms = end - new Date(started).getTime();
    if (ms < 0)
        return "—";
    const sec = Math.floor(ms / 1000);
    if (sec < 60)
        return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60)
        return `${min}m ${sec % 60}s`;
    const hr = Math.floor(min / 60);
    return `${hr}h ${min % 60}m`;
}
/** Format ISO string to locale date. */
function fmtDate(iso) {
    if (!iso)
        return "—";
    return new Date(iso).toLocaleString();
}
/** Get the first 8 chars of an ID. */
function shortId(id) {
    return id.substring(0, 8);
}
/** Agent category color mapping for the agent badge. */
const AGENT_COLORS = {
    orchestrator: "bg-purple-100 text-purple-700",
    execution: "bg-blue-100 text-blue-700",
    research: "bg-green-100 text-green-700",
    security: "bg-red-100 text-red-700",
    primary: "bg-purple-100 text-purple-700",
    qa: "bg-green-100 text-green-700",
    docs: "bg-amber-100 text-amber-700",
    scout: "bg-blue-100 text-blue-700",
    explore: "bg-teal-100 text-teal-700",
};
function agentBadgeColor(category) {
    return AGENT_COLORS[category] ?? "bg-gray-100 text-gray-600";
}
/** Status dot + label for a run. */
function RunStatusDot({ status }) {
    const map = {
        queued: "bg-gray-400",
        running: "bg-blue-500 animate-pulse",
        success: "bg-green-500",
        failed: "bg-red-500",
        timeout: "bg-red-500",
        cancelled: "bg-yellow-500",
    };
    const label = {
        queued: "Queued",
        running: "Running",
        success: "Success",
        failed: "Failed",
        timeout: "Timeout",
        cancelled: "Cancelled",
    };
    return (_jsxs("span", { className: "inline-flex items-center gap-1.5 text-xs", children: [_jsx("span", { className: `w-2 h-2 rounded-full ${map[status] ?? "bg-gray-400"}` }), label[status] ?? status] }));
}
/** Status badge for run table. */
function RunStatusBadge({ status }) {
    const colors = {
        queued: "bg-gray-200 text-gray-700",
        running: "bg-blue-100 text-blue-700",
        success: "bg-green-100 text-green-700",
        failed: "bg-red-100 text-red-700",
        timeout: "bg-red-100 text-red-700",
        cancelled: "bg-yellow-100 text-yellow-700",
    };
    const label = {
        queued: "Queued",
        running: "Running",
        success: "Success",
        failed: "Failed",
        timeout: "Timeout",
        cancelled: "Cancelled",
    };
    return (_jsx("span", { className: `px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? "bg-gray-200 text-gray-700"}`, children: label[status] ?? status }));
}
/* ------------------------------------------------------------------ */
/*  Cron preview helper                                               */
/* ------------------------------------------------------------------ */
function CronPreview({ cron }) {
    const parts = cron.trim().split(/\s+/);
    const labels = ["Minute", "Hour", "Day of Month", "Month", "Day of Week"];
    return (_jsxs("div", { children: [_jsx("div", { className: "flex gap-1.5 mb-1", children: parts.map((p, i) => (_jsx("code", { className: "px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700", title: labels[i], children: p }, i))) }), _jsx("p", { className: "text-xs text-gray-500", children: cronToHuman(cron) || "custom schedule" })] }));
}
const EMPTY_FORM = {
    name: "",
    description: "",
    agent: "",
    prompt_template: "",
    schedule_cron: "",
    trigger_event: "",
    timeout_minutes: 30,
};
function JobFormOverlay({ isOpen, onClose, initial, agents, project, onSaved, }) {
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    // Close on Escape
    useEffect(() => {
        if (!isOpen)
            return;
        const handleKeyDown = (e) => {
            if (e.key === "Escape")
                onClose();
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);
    // Lock body scroll while open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = "hidden";
        }
        return () => {
            document.body.style.overflow = "";
        };
    }, [isOpen]);
    useEffect(() => {
        if (initial) {
            setForm({
                name: initial.name,
                description: initial.description ?? "",
                agent: initial.agent,
                prompt_template: initial.prompt_template,
                schedule_cron: initial.schedule_cron ?? "",
                trigger_event: initial.trigger_event ?? "",
                timeout_minutes: initial.timeout_minutes,
            });
        }
        else {
            setForm(EMPTY_FORM);
        }
        setError("");
    }, [initial, isOpen]);
    const update = (field, value) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };
    const handleSave = async () => {
        if (!form.name.trim() || !form.agent || !form.prompt_template.trim()) {
            setError("Name, agent, and prompt template are required.");
            return;
        }
        setSaving(true);
        setError("");
        try {
            const payload = {
                name: form.name.trim(),
                description: form.description.trim() || undefined,
                agent: form.agent,
                prompt_template: form.prompt_template,
                schedule_cron: form.schedule_cron || undefined,
                trigger_event: form.trigger_event || undefined,
                timeout_minutes: form.timeout_minutes,
            };
            if (initial) {
                await api.jobs.update(initial.id, payload, project);
            }
            else {
                await api.jobs.create(payload, project);
            }
            onSaved();
            onClose();
        }
        catch (err) {
            setError(err?.message ?? "Save failed");
        }
        finally {
            setSaving(false);
        }
    };
    if (!isOpen)
        return null;
    return (_jsxs("div", { className: "fixed inset-0 z-50 flex items-center justify-center", children: [_jsx("div", { className: "absolute inset-0 bg-black/50", onClick: onClose }), _jsxs("div", { className: "relative bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] mx-4 flex flex-col", children: [_jsxs("div", { className: "flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h2", { className: "text-xl font-bold truncate", children: initial ? `Edit Job: ${initial.name}` : "Create Job" }), _jsx("p", { className: "text-sm text-gray-500 truncate", children: "Configure a scheduled or triggered agent job" })] }), _jsx("button", { onClick: onClose, className: "ml-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full shrink-0", "aria-label": "Close", children: _jsx("svg", { className: "w-5 h-5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M6 18L18 6M6 6l12 12" }) }) })] }), _jsxs("div", { className: "flex-1 overflow-y-auto px-6 py-4 space-y-4", children: [error && (_jsx("div", { className: "text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3", children: error })), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { className: "md:col-span-2", children: [_jsx("label", { className: "block text-xs font-medium text-gray-500 mb-1", children: "Name *" }), _jsx("input", { value: form.name, onChange: (e) => update("name", e.target.value), className: "w-full border border-gray-200 rounded px-3 py-1.5 text-sm", placeholder: "e.g., Nightly Security Scan" })] }), _jsxs("div", { className: "md:col-span-2", children: [_jsx("label", { className: "block text-xs font-medium text-gray-500 mb-1", children: "Description" }), _jsx("textarea", { value: form.description, onChange: (e) => update("description", e.target.value), className: "w-full border border-gray-200 rounded px-3 py-1.5 text-sm min-h-[60px]", placeholder: "Optional description of what this job does" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-medium text-gray-500 mb-1", children: "Agent *" }), _jsxs("select", { value: form.agent, onChange: (e) => update("agent", e.target.value), className: "w-full border border-gray-200 rounded text-sm bg-white px-3 py-1.5 hover:bg-gray-50 cursor-pointer", children: [_jsx("option", { value: "", children: "\u2014 Select agent \u2014" }), agents.map((a) => (_jsx("option", { value: a.name, children: a.name }, a.name)))] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-medium text-gray-500 mb-1", children: "Timeout (minutes)" }), _jsx("input", { type: "number", value: form.timeout_minutes, onChange: (e) => update("timeout_minutes", parseInt(e.target.value) || 30), className: "w-full border border-gray-200 rounded px-3 py-1.5 text-sm", min: 1, max: 1440 })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-medium text-gray-500 mb-1", children: "Schedule (cron)" }), _jsx("input", { value: form.schedule_cron, onChange: (e) => update("schedule_cron", e.target.value), className: "w-full border border-gray-200 rounded px-3 py-1.5 text-sm font-mono", placeholder: "*/15 * * * *" }), form.schedule_cron.trim() && (_jsx("div", { className: "mt-1", children: _jsx(CronPreview, { cron: form.schedule_cron }) }))] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-medium text-gray-500 mb-1", children: "Trigger Event (optional)" }), _jsx("input", { value: form.trigger_event, onChange: (e) => update("trigger_event", e.target.value), className: "w-full border border-gray-200 rounded px-3 py-1.5 text-sm", placeholder: "e.g., push, pr_opened" })] }), _jsxs("div", { className: "md:col-span-2", children: [_jsx("label", { className: "block text-xs font-medium text-gray-500 mb-1", children: "Prompt Template *" }), _jsx("textarea", { value: form.prompt_template, onChange: (e) => update("prompt_template", e.target.value), className: "w-full border border-gray-200 rounded px-3 py-1.5 text-sm min-h-[200px] font-mono", placeholder: `Write the prompt template. Use {{variable}} for dynamic values.` })] })] })] }), _jsxs("div", { className: "flex gap-2 px-6 py-4 border-t border-gray-200 shrink-0", children: [_jsx("button", { onClick: handleSave, disabled: saving, className: "bg-blue-600 text-white py-2 px-4 rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed", children: saving ? "Saving..." : initial ? "Update Job" : "Create Job" }), _jsx("button", { onClick: onClose, className: "py-2 px-4 rounded text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100", children: "Cancel" })] })] })] }));
}
/* ------------------------------------------------------------------ */
/*  Live Log Console                                                  */
/* ------------------------------------------------------------------ */
function LiveLogConsole({ run, project }) {
    const [logs, setLogs] = useState([]);
    const [pinned, setPinned] = useState(true);
    const containerRef = useRef(null);
    const pollRef = useRef(null);
    const maxSeqRef = useRef(undefined);
    const isRunning = run.status === "running";
    // Reset logs when run.id changes (different run selected)
    useEffect(() => {
        setLogs([]);
        maxSeqRef.current = undefined;
    }, [run.id]);
    // Poll logs every 2s while running; stop when finished
    useEffect(() => {
        const fetchLogs = async () => {
            try {
                const res = await api.jobs.runLogs(run.id, maxSeqRef.current, project);
                if (res.data && res.data.length > 0) {
                    const newMaxSeq = Math.max(...res.data.map((l) => l.seq));
                    maxSeqRef.current = newMaxSeq;
                    setLogs((prev) => [...prev, ...res.data]);
                }
            }
            catch {
                // silently ignore poll errors
            }
        };
        // Initial fetch on mount or when run.id/status changes
        fetchLogs();
        if (isRunning) {
            pollRef.current = setInterval(fetchLogs, 2000);
        }
        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, [run.id, isRunning, project]);
    // Auto-scroll when pinned
    useEffect(() => {
        if (pinned && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [logs, pinned]);
    return (_jsxs("div", { className: "space-y-2", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("h3", { className: "text-sm font-semibold text-gray-700", children: ["Logs ", isRunning && _jsx("span", { className: "text-xs text-gray-400 ml-1", children: "(live)" })] }), _jsxs("label", { className: "flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: pinned, onChange: (e) => setPinned(e.target.checked), className: "rounded" }), "Pin to bottom"] })] }), _jsxs("div", { ref: containerRef, className: "bg-gray-900 text-gray-100 font-mono text-xs p-4 rounded max-h-96 overflow-y-auto", children: [logs.length === 0 && (_jsxs("div", { className: "text-gray-500 italic flex items-center gap-2", children: [isRunning && (_jsxs("svg", { className: "animate-spin h-3 w-3", viewBox: "0 0 24 24", children: [_jsx("circle", { className: "opacity-25", cx: "12", cy: "12", r: "10", stroke: "currentColor", strokeWidth: "4", fill: "none" }), _jsx("path", { className: "opacity-75", fill: "currentColor", d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" })] })), "Waiting for output..."] })), logs.map((log) => (_jsxs("div", { className: "whitespace-pre-wrap break-all leading-relaxed", children: [_jsxs("span", { className: log.stream === "stderr" ? "text-red-400" : "text-green-400", children: ["[", log.seq, "]"] }), " ", _jsx("span", { children: log.line })] }, log.id)))] })] }));
}
/* ------------------------------------------------------------------ */
/*  Job Detail View                                                   */
/* ------------------------------------------------------------------ */
function JobDetailView({ job, onBack, onEdit, onRun, onToggleEnabled, onDelete, project, }) {
    const [runs, setRuns] = useState([]);
    const [selectedRun, setSelectedRun] = useState(null);
    const [loadingRuns, setLoadingRuns] = useState(false);
    const fetchRuns = useCallback(async () => {
        setLoadingRuns(true);
        try {
            const res = await api.jobs.runs(job.id, project);
            setRuns(res.data ?? []);
        }
        catch {
            // ignore
        }
        finally {
            setLoadingRuns(false);
        }
    }, [job.id, project]);
    // Poll run list every 5s while detail view is open.
    // Single interval — never depends on `runs` state.
    useEffect(() => {
        // Initial fetch on mount
        fetchRuns();
        const timer = setInterval(fetchRuns, 5000);
        return () => clearInterval(timer);
    }, [fetchRuns]);
    const activeRun = selectedRun ?? runs.find((r) => r.status === "running") ?? null;
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("button", { onClick: onBack, className: "text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1", children: [_jsx("svg", { className: "w-4 h-4", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M15 19l-7-7 7-7" }) }), "Back to jobs"] }), _jsxs("div", { className: "bg-white rounded-lg border p-6 hover:shadow-md transition-shadow", children: [_jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("h1", { className: "text-xl font-bold", children: job.name }), _jsx(RunStatusDot, { status: runs[0]?.status ?? "queued" })] }), job.description && _jsx("p", { className: "text-sm text-gray-600", children: job.description }), _jsxs("div", { className: "flex items-center gap-2 text-xs text-gray-500 pt-1", children: [_jsx("span", { className: `px-2 py-0.5 rounded font-medium ${agentBadgeColor(job.agent)}`, children: job.agent }), job.schedule_cron && (_jsx("span", { className: "bg-gray-100 text-gray-600 px-2 py-0.5 rounded", children: cronToHuman(job.schedule_cron) })), job.trigger_event && (_jsx("span", { className: "bg-gray-100 text-gray-600 px-2 py-0.5 rounded", children: job.trigger_event })), _jsxs("span", { className: "text-gray-400", children: ["Timeout: ", job.timeout_minutes, " min"] })] })] }), _jsx("div", { className: "flex items-center gap-2", children: _jsxs("label", { className: "flex items-center gap-1.5 text-sm cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: job.enabled, onChange: onToggleEnabled, className: "rounded" }), _jsx("span", { className: job.enabled ? "text-green-600" : "text-gray-400", children: job.enabled ? "Enabled" : "Disabled" })] }) })] }), job.prompt_template && (_jsxs("div", { className: "mt-4", children: [_jsx("h3", { className: "text-xs font-medium text-gray-500 mb-1", children: "Prompt Template" }), _jsx("pre", { className: "bg-gray-50 border border-gray-200 rounded p-3 text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto", children: job.prompt_template })] })), _jsxs("div", { className: "flex gap-2 mt-4", children: [_jsx("button", { onClick: onRun, className: "bg-green-600 text-white py-2 px-4 rounded text-sm hover:bg-green-700", children: "\u25B6 Run Now" }), _jsx("button", { onClick: onEdit, className: "bg-blue-600 text-white py-2 px-4 rounded text-sm hover:bg-blue-700", children: "Edit" }), _jsx("button", { onClick: onDelete, className: "bg-red-600 text-white py-2 px-4 rounded text-sm hover:bg-red-700", children: "Delete" })] })] }), _jsxs("div", { className: "space-y-4", children: [activeRun && (_jsxs("div", { className: "bg-white rounded-lg border p-4 hover:shadow-md transition-shadow", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("h3", { className: "text-sm font-semibold text-gray-700", children: ["Run ", _jsx("code", { className: "text-xs bg-gray-100 px-1 py-0.5 rounded", children: shortId(activeRun.id) })] }), _jsx(RunStatusBadge, { status: activeRun.status })] }), activeRun.status === "running" && (_jsx("button", { onClick: async () => {
                                            try {
                                                await api.jobs.cancelRun(activeRun.id, project);
                                                fetchRuns();
                                            }
                                            catch {
                                                // ignore
                                            }
                                        }, className: "text-xs text-red-600 hover:text-red-800 px-2 py-1 border border-red-200 rounded hover:bg-red-50", children: "Cancel Run" })), selectedRun && (_jsx("button", { onClick: () => setSelectedRun(null), className: "text-xs text-gray-500 hover:text-gray-700", children: "Close" }))] }), _jsx(LiveLogConsole, { run: activeRun, project: project })] })), _jsxs("div", { className: "bg-white rounded-lg border hover:shadow-md transition-shadow overflow-hidden", children: [_jsx("div", { className: "px-4 py-3 border-b border-gray-200", children: _jsxs("h3", { className: "text-sm font-semibold text-gray-700", children: ["Run History (", runs.length, ")"] }) }), loadingRuns && runs.length === 0 ? (_jsx("div", { className: "p-4 text-sm text-gray-400", children: "Loading..." })) : runs.length === 0 ? (_jsx("div", { className: "p-4 text-sm text-gray-400 italic", children: "No runs yet." })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-gray-100 text-left text-xs text-gray-500", children: [_jsx("th", { className: "px-4 py-2 font-medium", children: "ID" }), _jsx("th", { className: "px-4 py-2 font-medium", children: "Status" }), _jsx("th", { className: "px-4 py-2 font-medium", children: "Trigger" }), _jsx("th", { className: "px-4 py-2 font-medium", children: "Started" }), _jsx("th", { className: "px-4 py-2 font-medium", children: "Duration" }), _jsx("th", { className: "px-4 py-2 font-medium", children: "Exit" })] }) }), _jsx("tbody", { children: runs.map((run) => (_jsxs("tr", { onClick: () => setSelectedRun(run), className: `border-b border-gray-50 cursor-pointer hover:bg-gray-50 ${selectedRun?.id === run.id ? "bg-blue-50" : ""}`, children: [_jsx("td", { className: "px-4 py-2 font-mono text-xs", children: shortId(run.id) }), _jsx("td", { className: "px-4 py-2", children: _jsx(RunStatusBadge, { status: run.status }) }), _jsx("td", { className: "px-4 py-2 text-gray-600", children: run.trigger }), _jsx("td", { className: "px-4 py-2 text-gray-500 text-xs", children: fmtDate(run.started_at) }), _jsx("td", { className: "px-4 py-2 text-gray-500", children: duration(run.started_at, run.finished_at) }), _jsx("td", { className: "px-4 py-2", children: run.status === "running" ? (_jsx("span", { className: "text-blue-500", children: "\u2014" })) : run.exit_code != null ? (_jsx("span", { className: run.exit_code === 0 ? "text-green-600" : "text-red-600", children: run.exit_code })) : (_jsx("span", { className: "text-gray-400", children: "\u2014" })) })] }, run.id))) })] }) }))] })] })] }));
}
/* ------------------------------------------------------------------ */
/*  Main Jobs Page                                                    */
/* ------------------------------------------------------------------ */
export default function JobsPage() {
    const project = useProject();
    const [jobs, setJobs] = useState([]);
    const [agents, setAgents] = useState([]);
    const [selectedJob, setSelectedJob] = useState(null);
    const [showCreate, setShowCreate] = useState(false);
    const [editingJob, setEditingJob] = useState(undefined);
    const [error, setError] = useState("");
    const fetchJobs = useCallback(async () => {
        try {
            const res = await api.jobs.list(project);
            setJobs(res.data ?? []);
        }
        catch {
            // ignore
        }
    }, [project]);
    useEffect(() => {
        fetchJobs();
        api.agents.list(project).then((r) => setAgents(r.data ?? [])).catch(() => { });
    }, [fetchJobs, project]);
    // Sort: enabled first, then by name
    const sortedJobs = useMemo(() => {
        return [...jobs].sort((a, b) => {
            if (a.enabled !== b.enabled)
                return a.enabled ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    }, [jobs]);
    const handleToggleEnabled = useCallback(async (job) => {
        try {
            const updated = await api.jobs.update(job.id, { enabled: !job.enabled }, project);
            setJobs((prev) => prev.map((j) => (j.id === job.id ? updated.data : j)));
            if (selectedJob?.id === job.id)
                setSelectedJob(updated.data);
        }
        catch {
            // ignore
        }
    }, [project, selectedJob]);
    const handleRun = useCallback(async (job) => {
        try {
            setError("");
            await api.jobs.run(job.id, project);
            // Refresh jobs to update last-run status indirectly via runs
            fetchJobs();
        }
        catch (err) {
            setError(err?.message ?? "Failed to run job");
        }
    }, [project, fetchJobs]);
    const handleDelete = useCallback(async (job) => {
        if (!confirm(`Delete job "${job.name}"? This cannot be undone.`))
            return;
        try {
            await api.jobs.delete(job.id, project);
            setSelectedJob(null);
            fetchJobs();
        }
        catch {
            // ignore
        }
    }, [project, fetchJobs]);
    const handleEdit = useCallback((job) => {
        setEditingJob(job);
        setShowCreate(true);
    }, []);
    // Last-run status dot for a job card
    const getLastRunStatus = useCallback(async (jobId) => {
        try {
            const res = await api.jobs.runs(jobId, project, 1);
            const first = res.data?.[0];
            if (first) {
                return first.status;
            }
        }
        catch {
            // ignore
        }
        return null;
    }, [project]);
    // JobDetail view
    if (selectedJob) {
        return (_jsx(JobDetailView, { job: selectedJob, onBack: () => setSelectedJob(null), onEdit: () => handleEdit(selectedJob), onRun: () => handleRun(selectedJob), onToggleEnabled: () => handleToggleEnabled(selectedJob), onDelete: () => handleDelete(selectedJob), project: project }, selectedJob.id));
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h1", { className: "text-3xl font-bold", children: "Jobs" }), _jsx("button", { onClick: () => {
                            setEditingJob(undefined);
                            setShowCreate(true);
                        }, className: "bg-blue-600 text-white py-2 px-4 rounded text-sm hover:bg-blue-700", children: "Create Job" })] }), error && (_jsx("div", { className: "text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3", children: error })), sortedJobs.length === 0 ? (_jsxs("div", { className: "text-center text-gray-500 py-12", children: [_jsx("p", { className: "text-lg font-semibold", children: "No jobs yet" }), _jsx("p", { className: "text-sm mt-1", children: "Create a job to schedule agent runs." })] })) : (_jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4", children: sortedJobs.map((job) => (_jsx(JobCard, { job: job, onClick: () => setSelectedJob(job), onRun: () => handleRun(job), onToggleEnabled: () => handleToggleEnabled(job), getLastRunStatus: getLastRunStatus }, job.id))) })), showCreate && (_jsx(JobFormOverlay, { isOpen: showCreate, onClose: () => {
                    setShowCreate(false);
                    setEditingJob(undefined);
                }, initial: editingJob, agents: agents, project: project, onSaved: fetchJobs }))] }));
}
/* ------------------------------------------------------------------ */
/*  Job Card (grid item)                                              */
/* ------------------------------------------------------------------ */
function JobCard({ job, onClick, onRun, onToggleEnabled, getLastRunStatus, }) {
    const [lastStatus, setLastStatus] = useState(null);
    useEffect(() => {
        getLastRunStatus(job.id).then(setLastStatus);
    }, [job.id, getLastRunStatus]);
    const statusDotColor = {
        running: "bg-blue-500 animate-pulse",
        success: "bg-green-500",
        failed: "bg-red-500",
        timeout: "bg-red-500",
        cancelled: "bg-yellow-500",
        queued: "bg-gray-400",
    };
    return (_jsxs("div", { className: "bg-white border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer", onClick: onClick, children: [_jsxs("div", { className: "flex items-start justify-between mb-2", children: [_jsx("div", { className: "flex-1 min-w-0", children: _jsx("h2", { className: "text-lg font-semibold text-gray-900 truncate", children: job.name }) }), _jsxs("div", { className: "flex items-center gap-2 ml-2 shrink-0", children: [lastStatus ? (_jsx("span", { className: `w-3 h-3 rounded-full ${statusDotColor[lastStatus] ?? "bg-gray-400"}`, title: lastStatus })) : (_jsx("span", { className: "w-3 h-3 rounded-full bg-gray-300", title: "Never run" })), _jsx("button", { onClick: (e) => {
                                    e.stopPropagation();
                                    onRun();
                                }, className: "text-gray-400 hover:text-green-600 p-1 rounded hover:bg-green-50", title: "Run Now", children: _jsx("svg", { className: "w-4 h-4", fill: "currentColor", viewBox: "0 0 20 20", children: _jsx("path", { fillRule: "evenodd", d: "M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z", clipRule: "evenodd" }) }) })] })] }), job.description && (_jsx("p", { className: "text-sm text-gray-600 mb-2 line-clamp-2", children: job.description })), _jsx("div", { className: "flex items-center gap-2 mb-2", children: _jsx("span", { className: `text-xs px-2 py-0.5 rounded font-medium ${agentBadgeColor(job.agent)}`, children: job.agent }) }), job.schedule_cron && (_jsxs("p", { className: "text-xs text-gray-500", children: ["Runs: ", cronToHuman(job.schedule_cron)] })), _jsxs("div", { className: "flex items-center justify-between mt-3 pt-3 border-t border-gray-100", children: [_jsxs("label", { className: "flex items-center gap-1.5 text-sm cursor-pointer", onClick: (e) => e.stopPropagation(), children: [_jsx("input", { type: "checkbox", checked: job.enabled, onChange: onToggleEnabled, className: "rounded" }), _jsx("span", { className: job.enabled ? "text-green-600 text-xs" : "text-gray-400 text-xs", children: job.enabled ? "Enabled" : "Disabled" })] }), _jsxs("span", { className: "text-xs text-gray-400", children: ["Timeout: ", job.timeout_minutes, "m"] })] })] }));
}
