"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useProject } from "../../lib/ProjectContext";
import Overlay from "../components/Overlay";
import { api, Job, JobRun, JobRunLog, Agent } from "../../lib/api";
import { badgeTones, BADGE_BASE } from "@/lib/badgeTones";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4097/api/v1";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Map a cron string to a human-readable description. */
function cronToHuman(cron: string | undefined | null): string {
  if (!cron) return "";
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [min, hour, dayOfMonth, , dayOfWeek] = parts;

  // Special cases
  if (cron === "* * * * *") return "every minute";
  if (cron === "0 * * * *") return "hourly";
  if (cron === "0 0 * * *") return "daily at midnight";
  if (cron === "0 0 * * 0") return "weekly on Sunday";
  if (cron === "0 0 1 * *") return "monthly on the 1st";

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
    const h = parseInt(hour!, 10);
    const m = parseInt(min!, 10);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `daily at ${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  return cron;
}

/** Return a duration string between two ISO datetimes. */
function duration(started?: string | null, finished?: string | null): string {
  if (!started) return "—";
  const end = finished ? new Date(finished).getTime() : Date.now();
  const ms = end - new Date(started).getTime();
  if (ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

/** Format ISO string to locale date. */
function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

/** Get the first 8 chars of an ID. */
function shortId(id: string): string {
  return id.substring(0, 8);
}

function agentBadgeColor(category: string): string {
  const hues: Record<string, string> = {
    orchestrator: "purple",
    execution: "blue",
    research: "green",
    security: "red",
    primary: "purple",
    qa: "green",
    docs: "amber",
    scout: "blue",
    explore: "teal",
  };
  return badgeTones(hues[category] ?? "gray");
}

/** Status dot + label for a run. */
function RunStatusDot({ status }: { status: JobRun["status"] }) {
  const map: Record<string, string> = {
    queued: "bg-gray-400 dark:bg-gray-500",
    running: "bg-[var(--color-accent)] animate-pulse",
    success: "bg-green-500",
    failed: "bg-red-500",
    timeout: "bg-red-500",
    cancelled: "bg-yellow-500 dark:bg-amber-400",
  };
  const label: Record<string, string> = {
    queued: "Queued",
    running: "Running",
    success: "Success",
    failed: "Failed",
    timeout: "Timeout",
    cancelled: "Cancelled",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`w-2 h-2 rounded-full ${map[status] ?? "bg-gray-400"}`} />
      {label[status] ?? status}
    </span>
  );
}

/** Status badge for run table. */
function RunStatusBadge({ status }: { status: JobRun["status"] }) {
  const colors: Record<string, string> = {
    queued: badgeTones("gray"),
    running: badgeTones("blue"),
    success: badgeTones("success"),
    failed: badgeTones("error"),
    timeout: badgeTones("error"),
    cancelled: badgeTones("amber"),
  };
  const label: Record<string, string> = {
    queued: "Queued",
    running: "Running",
    success: "Success",
    failed: "Failed",
    timeout: "Timeout",
    cancelled: "Cancelled",
  };
  return (
    <span className={`${BADGE_BASE} ${colors[status] ?? badgeTones("gray")}`}>
      {label[status] ?? status}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Cron preview helper                                               */
/* ------------------------------------------------------------------ */

function CronPreview({ cron }: { cron: string }) {
  const parts = cron.trim().split(/\s+/);
  const labels = ["Minute", "Hour", "Day of Month", "Month", "Day of Week"];
  return (
    <div>
      <div className="flex gap-1.5 mb-1">
        {parts.map((p, i) => (
          <code key={i} className="px-1.5 py-0.5 bg-[var(--color-surface-muted)] rounded text-xs font-mono text-[var(--color-text-primary)]" title={labels[i]}>
            {p}
          </code>
        ))}
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">{cronToHuman(cron) || "custom schedule"}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Create / Edit Overlay                                             */
/* ------------------------------------------------------------------ */

type JobFormData = {
  name: string;
  description: string;
  agent: string;
  prompt_template: string;
  schedule_cron: string;
  trigger_event: string;
  timeout_minutes: number;
};

const EMPTY_FORM: JobFormData = {
  name: "",
  description: "",
  agent: "",
  prompt_template: "",
  schedule_cron: "",
  trigger_event: "",
  timeout_minutes: 30,
};

function JobFormOverlay({
  isOpen,
  onClose,
  initial,
  agents,
  project,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  initial?: Job;
  agents: Agent[];
  project: string;
  onSaved: (savedJob?: Job) => void;
}) {
  const [form, setForm] = useState<JobFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [wandLoading, setWandLoading] = useState(false);
  const [wandError, setWandError] = useState<string | null>(null);
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);

  // Escape + body scroll lock handled by Overlay component

  useEffect(() => {
    api.settings.get("synthesis_model", project).then(res => {
      setLlmConfigured(!!res?.data?.value);
    }).catch(() => setLlmConfigured(false));
  }, [project]);

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
    } else {
      setForm(EMPTY_FORM);
    }
    setError("");
    setWandError(null);
    setWandLoading(false);
  }, [initial, isOpen]);

  const update = (field: keyof JobFormData, value: string | number) => {
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
      let savedJob: Job | undefined;
      if (initial) {
        const res = await api.jobs.update(initial.id, payload, project);
        savedJob = res.data;
      } else {
        const res = await api.jobs.create(payload, project);
        savedJob = res.data;
      }
      onSaved(savedJob);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Overlay
      isOpen={isOpen}
      onClose={onClose}
      title={initial ? `Edit Job: ${initial.name}` : "Create Job"}
      subtitle="Configure a scheduled or triggered agent job"
    >
      <div className="space-y-4">
        {error && (
          <div className="text-[var(--color-error-text)] text-sm bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded p-3">{error}</div>
        )}

        {/* 2-column layout: metadata left, prompt right */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column — metadata */}
          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                className="w-full border border-[var(--color-border)] rounded px-3 py-1.5 text-sm"
                placeholder="e.g., Nightly Security Scan"
              />
            </div>

            {/* Description with wand */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium">Description</label>
                {llmConfigured && (
                  <button
                    onClick={async () => {
                      if (!form.description.trim()) return;
                      setWandLoading(true);
                      setWandError(null);
                      try {
                        const res = await fetch(`${API_BASE}/jobs/suggest?project=${project}`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ description: form.description.trim() }),
                        });
                        if (!res.ok) {
                          setWandError("AI generation failed — try again later");
                          setWandLoading(false);
                          return;
                        }
                        const data = await res.json().catch(() => ({ data: null }));
                        const d = data.data || data;
                        if (d?.configured === false) {
                          setWandError("Configure a Synthesis LLM in Settings to enable AI suggestions");
                        } else if (d?.prompt_template || d?.schedule_cron || d?.trigger_event) {
                          const updates: Partial<JobFormData> = {};
                          if (d.prompt_template) updates.prompt_template = d.prompt_template;
                          if (d.schedule_cron) updates.schedule_cron = d.schedule_cron;
                          if (d.trigger_event) updates.trigger_event = d.trigger_event;
                          setForm(prev => ({ ...prev, ...updates }));
                        } else {
                          setWandError("AI could not derive job settings from this description");
                        }
                      } catch {
                        setWandError("AI generation failed — try again later");
                      } finally {
                        setWandLoading(false);
                      }
                    }}
                    disabled={wandLoading || !form.description.trim()}
                    title="Auto-generate job config from description"
                    className="flex items-center gap-1 text-xs text-[var(--color-text-link)] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {wandLoading ? (
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                      </svg>
                    )}
                    <span>Auto-generate</span>
                  </button>
                )}
              </div>
              <textarea
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                className="w-full border border-[var(--color-border)] rounded px-3 py-1.5 text-sm min-h-[60px]"
                placeholder="Describe what this job should do (e.g., 'Run a security scan every night at 2am')"
              />
              {wandError && (
                <p className="text-xs text-[var(--color-error-text)] mt-1">{wandError}</p>
              )}
            </div>

            {/* Agent dropdown */}
            <div>
              <label className="block text-sm font-medium mb-1">Agent *</label>
              <select
                value={form.agent}
                onChange={(e) => update("agent", e.target.value)}
                className="w-full border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
              >
                <option value="">— Select agent —</option>
                {agents.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 2-col row: Cron + Timeout */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Schedule (cron)</label>
                <input
                  value={form.schedule_cron}
                  onChange={(e) => update("schedule_cron", e.target.value)}
                  className="w-full border border-[var(--color-border)] rounded px-3 py-1.5 text-sm font-mono"
                  placeholder="*/15 * * * *"
                />
                {form.schedule_cron.trim() && (
                  <div className="mt-1"><CronPreview cron={form.schedule_cron} /></div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Timeout (minutes)</label>
                <input
                  type="number"
                  value={form.timeout_minutes}
                  onChange={(e) => update("timeout_minutes", parseInt(e.target.value) || 30)}
                  className="w-full border border-[var(--color-border)] rounded px-3 py-1.5 text-sm"
                  min={1}
                  max={1440}
                />
              </div>
            </div>

            {/* Trigger Event */}
            <div>
              <label className="block text-sm font-medium mb-1">Trigger Event (optional)</label>
              <input
                value={form.trigger_event}
                onChange={(e) => update("trigger_event", e.target.value)}
                className="w-full border border-[var(--color-border)] rounded px-3 py-1.5 text-sm"
                placeholder="e.g., push, pr_opened"
              />
            </div>
          </div>

          {/* Right column — prompt */}
          <div>
            <label className="block text-sm font-medium mb-1">Prompt Template *</label>
            <textarea
              value={form.prompt_template}
              onChange={(e) => update("prompt_template", e.target.value)}
              className="w-full border border-[var(--color-border)] rounded px-3 py-1.5 text-sm font-mono min-h-[320px]"
              placeholder={`Write the prompt template. Use {{variable}} for dynamic values.`}
              rows={12}
            />
          </div>
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 border border-[var(--color-border)] rounded text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50"
          >
            {saving ? "Saving..." : initial ? "Update Job" : "Create Job"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ------------------------------------------------------------------ */
/*  Live Log Console                                                  */
/* ------------------------------------------------------------------ */

function LiveLogConsole({ run, project }: { run: JobRun; project: string }) {
  const [logs, setLogs] = useState<JobRunLog[]>([]);
  const [pinned, setPinned] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxSeqRef = useRef<number | undefined>(undefined);

  const isRunning = run.status === "running";

  // Reset logs when run.id changes (different run selected)
  useEffect(() => {
    setLogs([]);
    maxSeqRef.current = undefined;
  }, [run.id]);

  // Poll logs every 2s while running; stop when finished.
  // 2s is tight enough to feel "live" without excessive API pressure
  // during long-running agent jobs that may produce output infrequently.
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await api.jobs.runLogs(run.id, maxSeqRef.current, project);
        if (res.data && res.data.length > 0) {
          const newMaxSeq = Math.max(...res.data.map((l) => l.seq));
          maxSeqRef.current = newMaxSeq;
          setLogs((prev) => [...prev, ...res.data]);
        }
      } catch {
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Logs {isRunning && <span className="text-xs text-[var(--color-text-muted)] ml-1">(live)</span>}
        </h3>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] cursor-pointer">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="rounded"
          />
          Pin to bottom
        </label>
      </div>

      <div
        ref={containerRef}
        className="bg-gray-900 text-gray-100 font-mono text-xs p-4 rounded max-h-96 overflow-y-auto"
      >
        {logs.length === 0 && (
          <div className="text-[var(--color-text-muted)] italic flex items-center gap-2">
            {isRunning && (
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            Waiting for output...
          </div>
        )}
        {logs.map((log) => (
          <div key={log.id} className="whitespace-pre-wrap break-all leading-relaxed">
            <span className={log.stream === "stderr" ? "text-red-400" : "text-green-400"}>
              [{log.seq}]
            </span>{" "}
            <span>{log.line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Job Detail View                                                   */
/* ------------------------------------------------------------------ */

function JobDetailView({
  job,
  onBack,
  onEdit,
  onRun,
  onToggleEnabled,
  onDelete,
  project,
}: {
  job: Job;
  onBack: () => void;
  onEdit: () => void;
  onRun: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  project: string;
}) {
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<JobRun | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);

  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await api.jobs.runs(job.id, project);
      setRuns(res.data ?? []);
    } catch {
      // ignore
    } finally {
      setLoadingRuns(false);
    }
  }, [job.id, project]);

  const activeRun = selectedRun ?? runs.find((r) => r.status === "running") ?? null;

  // Poll run list every 2s only while a run is actively running.
  // Dependencies track id + status (not the full object) to avoid re-renders.
  // The `fetchRuns` callback is stable via useCallback with [job.id, project].
  useEffect(() => {
    // Initial fetch on mount
    fetchRuns();

    if (!activeRun || activeRun.status !== "running") return;

    const timer = setInterval(fetchRuns, 2000);
    return () => clearInterval(timer);
  }, [fetchRuns, activeRun?.id, activeRun?.status]);

  return (
    <div className="space-y-6">
      {/* Back link */}
      <button
        onClick={onBack}
        className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] flex items-center gap-1"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to jobs
      </button>

      {/* Job info card */}
      <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-6 hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{job.name}</h1>
              <RunStatusDot status={runs[0]?.status ?? "queued"} />
            </div>
            {job.description && <p className="text-sm text-[var(--color-text-secondary)]">{job.description}</p>}
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] pt-1">
              <span className={`px-2 py-0.5 rounded font-medium ${agentBadgeColor(job.agent)}`}>
                {job.agent}
              </span>
              {job.schedule_cron && (
                <span className="bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] px-2 py-0.5 rounded">
                  {cronToHuman(job.schedule_cron)}
                </span>
              )}
              {job.trigger_event && (
                <span className="bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] px-2 py-0.5 rounded">{job.trigger_event}</span>
              )}
              <span className="text-[var(--color-text-muted)]">Timeout: {job.timeout_minutes} min</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={job.enabled}
                onChange={onToggleEnabled}
                className="rounded"
              />
              <span className={job.enabled ? "text-[var(--color-success-text)]" : "text-[var(--color-text-muted)]"}>
                {job.enabled ? "Enabled" : "Disabled"}
              </span>
            </label>
          </div>
        </div>

        {/* Prompt template preview */}
        {job.prompt_template && (
          <div className="mt-4">
            <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1">Prompt Template</h3>
            <pre className="bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded p-3 text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
              {job.prompt_template}
            </pre>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={onRun}
            className="bg-green-600 text-white py-2 px-4 rounded text-sm hover:bg-green-700"
          >
            ▶ Run Now
          </button>
          <button
            onClick={onEdit}
            className="bg-blue-600 text-white py-2 px-4 rounded text-sm hover:bg-blue-700"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="bg-red-600 text-white py-2 px-4 rounded text-sm hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Run history + live log */}
      <div className="space-y-4">
        {/* Live log for active run */}
        {activeRun && (
          <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  Run <code className="text-xs bg-[var(--color-surface-muted)] px-1 py-0.5 rounded">{shortId(activeRun.id)}</code>
                </h3>
                <RunStatusBadge status={activeRun.status} />
              </div>
              {activeRun.status === "running" && (
                <button
                  onClick={async () => {
                    try {
                      await api.jobs.cancelRun(activeRun.id, project);
                      fetchRuns();
                    } catch {
                      // ignore
                    }
                  }}
                  className="text-xs text-[var(--color-error-text)] hover:text-red-800 px-2 py-1 border border-[var(--color-error-border)] rounded hover:bg-[var(--color-error-bg)]"
                >
                  Cancel Run
                </button>
              )}
              {selectedRun && (
                <button
                  onClick={() => setSelectedRun(null)}
                  className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                >
                  Close
                </button>
              )}
            </div>
            <LiveLogConsole run={activeRun} project={project} />
          </div>
        )}

        {/* Run history table */}
        <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] hover:shadow-md transition-shadow overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Run History ({runs.length})</h3>
          </div>
          {loadingRuns && runs.length === 0 ? (
            <div className="p-4 text-sm text-[var(--color-text-muted)]">Loading...</div>
          ) : runs.length === 0 ? (
            <div className="p-4 text-sm text-[var(--color-text-muted)] italic">No runs yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-muted)] text-left text-xs text-[var(--color-text-muted)]">
                    <th className="px-4 py-2 font-medium">ID</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Trigger</th>
                    <th className="px-4 py-2 font-medium">Started</th>
                    <th className="px-4 py-2 font-medium">Duration</th>
                    <th className="px-4 py-2 font-medium">Exit</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      onClick={() => setSelectedRun(run)}
                      className={`border-b border-gray-50 cursor-pointer hover:bg-[var(--color-surface-hover)] ${
                        selectedRun?.id === run.id ? "bg-[var(--color-surface-selected)]" : ""
                      }`}
                    >
                      <td className="px-4 py-2 font-mono text-xs">{shortId(run.id)}</td>
                      <td className="px-4 py-2">
                        <RunStatusBadge status={run.status} />
                      </td>
                      <td className="px-4 py-2 text-[var(--color-text-secondary)]">{run.trigger}</td>
                      <td className="px-4 py-2 text-[var(--color-text-muted)] text-xs">{fmtDate(run.started_at)}</td>
                      <td className="px-4 py-2 text-[var(--color-text-muted)]">{duration(run.started_at, run.finished_at)}</td>
                      <td className="px-4 py-2">
                        {run.status === "running" ? (
                          <span className="text-blue-500">—</span>
                        ) : run.exit_code != null ? (
                          <span className={run.exit_code === 0 ? "text-[var(--color-success-text)]" : "text-[var(--color-error-text)]"}>
                            {run.exit_code}
                          </span>
                        ) : (
                          <span className="text-[var(--color-text-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Jobs Page                                                    */
/* ------------------------------------------------------------------ */

/**
 * JobsPage — Scheduled and triggered agent job management.
 *
 * Sub-components:
 *   - JobFormOverlay: Create/edit form with AI-assisted auto-generation
 *     ("wand" button) that derives cron/trigger/prompt from description.
 *   - JobDetailView: Single-job view with run history table + live log
 *     console that polls every 2s while a run is active.
 *   - JobCard: Grid tile showing name, description, last-run status dot.
 *
 * Live log polling interval (2s) balances responsiveness vs. API load.
 * The cancel-run path uses fire-and-forget and re-fetches the run list
 * on the next poll cycle.
 */
export default function JobsPage() {
  const project = useProject();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | undefined>(undefined);
  const [error, setError] = useState("");

  const fetchJobs = useCallback(async () => {
    try {
      const res = await api.jobs.list(project);
      setJobs(res.data ?? []);
    } catch {
      // ignore
    }
  }, [project]);

  useEffect(() => {
    fetchJobs();
    api.agents.list(project).then((r) => setAgents(r.data ?? [])).catch(() => {});
  }, [fetchJobs, project]);

  // Sort: enabled first, then by name
  const sortedJobs = useMemo(() => {
    return [...jobs].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [jobs]);

  const handleToggleEnabled = useCallback(
    async (job: Job) => {
      try {
        const updated = await api.jobs.update(job.id, { enabled: !job.enabled }, project);
        setJobs((prev) => prev.map((j) => (j.id === job.id ? updated.data : j)));
        if (selectedJob?.id === job.id) setSelectedJob(updated.data);
      } catch {
        // ignore
      }
    },
    [project, selectedJob]
  );

  const handleRun = useCallback(
    async (job: Job) => {
      try {
        setError("");
        await api.jobs.run(job.id, project);
        // Refresh jobs to update last-run status indirectly via runs
        fetchJobs();
      } catch (err: any) {
        setError(err?.message ?? "Failed to run job");
      }
    },
    [project, fetchJobs]
  );

  const handleDelete = useCallback(
    async (job: Job) => {
      if (!confirm(`Delete job "${job.name}"? This cannot be undone.`)) return;
      try {
        await api.jobs.delete(job.id, project);
        setSelectedJob(null);
        fetchJobs();
      } catch {
        // ignore
      }
    },
    [project, fetchJobs]
  );

  const handleEdit = useCallback((job: Job) => {
    setEditingJob(job);
    setShowCreate(true);
  }, []);

  const handleSaved = useCallback(async (savedJob?: Job) => {
    await fetchJobs();
    if (editingJob && savedJob) {
      setSelectedJob(savedJob);
    }
  }, [fetchJobs, editingJob]);

  // Last-run status dot for a job card
  const getLastRunStatus = useCallback(
    async (jobId: string): Promise<JobRun["status"] | null> => {
      try {
        const res = await api.jobs.runs(jobId, project, 1);
        const first = res.data?.[0];
        if (first) {
          return first.status;
        }
      } catch {
        // ignore
      }
      return null;
    },
    [project]
  );

  return (
    <>
      {selectedJob ? (
        <JobDetailView
          key={selectedJob.id}
          job={selectedJob}
          onBack={() => setSelectedJob(null)}
          onEdit={() => handleEdit(selectedJob)}
          onRun={() => handleRun(selectedJob)}
          onToggleEnabled={() => handleToggleEnabled(selectedJob)}
          onDelete={() => handleDelete(selectedJob)}
          project={project}
        />
      ) : (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold">Jobs</h1>
            <button
              onClick={() => {
                setEditingJob(undefined);
                setShowCreate(true);
              }}
              className="bg-blue-600 text-white py-2 px-4 rounded text-sm hover:bg-blue-700"
            >
              Create Job
            </button>
          </div>

          {error && (
            <div className="text-[var(--color-error-text)] text-sm bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded p-3">{error}</div>
          )}

          {/* Job cards grid */}
          {sortedJobs.length === 0 ? (
            <div className="text-center text-[var(--color-text-muted)] py-12">
              <p className="text-lg font-semibold">No jobs yet</p>
              <p className="text-sm mt-1">Create a job to schedule agent runs.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onClick={() => setSelectedJob(job)}
                  onRun={() => handleRun(job)}
                  onToggleEnabled={() => handleToggleEnabled(job)}
                  getLastRunStatus={getLastRunStatus}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create / Edit overlay — hoisted outside detail/list conditional */}
      {showCreate && (
        <JobFormOverlay
          isOpen={showCreate}
          onClose={() => {
            setShowCreate(false);
            setEditingJob(undefined);
            setError("");
          }}
          initial={editingJob}
          agents={agents}
          project={project}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Job Card (grid item)                                              */
/* ------------------------------------------------------------------ */

function JobCard({
  job,
  onClick,
  onRun,
  onToggleEnabled,
  getLastRunStatus,
}: {
  job: Job;
  onClick: () => void;
  onRun: () => void;
  onToggleEnabled: () => void;
  getLastRunStatus: (jobId: string) => Promise<JobRun["status"] | null>;
}) {
  const [lastStatus, setLastStatus] = useState<JobRun["status"] | null>(null);

  useEffect(() => {
    getLastRunStatus(job.id).then(setLastStatus);
  }, [job.id, getLastRunStatus]);

  const statusDotColor: Record<string, string> = {
    running: "bg-[var(--color-accent)] animate-pulse",
    success: "bg-green-500",
    failed: "bg-red-500",
    timeout: "bg-red-500",
    cancelled: "bg-yellow-500 dark:bg-amber-400",
    queued: "bg-gray-400 dark:bg-gray-500",
  };

  return (
    <div
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] truncate">{job.name}</h2>
        </div>
        <div className="flex items-center gap-2 ml-2 shrink-0">
          {lastStatus ? (
            <span
              className={`w-3 h-3 rounded-full ${statusDotColor[lastStatus] ?? "bg-gray-400"}`}
              title={lastStatus}
            />
          ) : (
            <span className="w-3 h-3 rounded-full bg-gray-300" title="Never run" />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRun();
            }}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-success-text)] p-1 rounded hover:bg-[var(--color-success-bg)]"
            title="Run Now"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {job.description && (
        <p className="text-sm text-[var(--color-text-secondary)] mb-2 line-clamp-2">{job.description}</p>
      )}

      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${agentBadgeColor(job.agent)}`}>
          {job.agent}
        </span>
      </div>

      {job.schedule_cron && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Runs: {cronToHuman(job.schedule_cron)}
        </p>
      )}

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--color-border-muted)]">
        <label
          className="flex items-center gap-1.5 text-sm cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={job.enabled}
            onChange={onToggleEnabled}
            className="rounded"
          />
          <span className={job.enabled ? "text-[var(--color-success-text)] text-xs" : "text-[var(--color-text-muted)] text-xs"}>
            {job.enabled ? "Enabled" : "Disabled"}
          </span>
        </label>
        <span className="text-xs text-[var(--color-text-muted)]">Timeout: {job.timeout_minutes}m</span>
      </div>
    </div>
  );
}
