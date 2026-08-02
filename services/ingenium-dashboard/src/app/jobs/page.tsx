"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useProject } from "@/lib/ProjectContext";
import {
  api,
  ApiError,
  type Agent,
  type Job,
  type JobEventDelivery,
  type JobEventDeliveryState,
  type JobRun,
  type JobRunLog,
  sanitizeJobDisplayText,
  TRUSTED_JOB_EVENT_TYPES,
  type TrustedJobEvent,
  type TrustedJobEventType,
} from "@/lib/api";
import { badgeTones, BADGE_BASE } from "@/lib/badgeTones";
import Overlay from "../components/Overlay";
import Select from "../components/Select";

const PAGE_LIMIT = 20;
const POLL_INTERVAL_MS = 5_000;
const TABS = ["jobs", "queue", "events"] as const;
type JobsTab = (typeof TABS)[number];

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

function cronToHuman(cron: string | undefined | null): string {
  if (!cron) return "";
  if (cron === "* * * * *") return "every minute";
  if (cron === "0 * * * *") return "hourly";
  if (cron === "0 0 * * *") return "daily at midnight";
  if (cron === "0 0 * * 0") return "weekly on Sunday";
  if (cron === "0 0 1 * *") return "monthly on the 1st";
  const [minute, hour, dayOfMonth, , dayOfWeek] = cron.trim().split(/\s+/);
  const minuteEvery = minute?.match(/^\*\/(\d+)$/);
  const hourEvery = hour?.match(/^\*\/(\d+)$/);
  if (minuteEvery && hour === "*" && dayOfMonth === "*" && dayOfWeek === "*") return `every ${minuteEvery[1]} min`;
  if (minute === "0" && hourEvery && dayOfMonth === "*" && dayOfWeek === "*") return `every ${hourEvery[1]} hours`;
  return cron;
}

function duration(started?: string | null, finished?: string | null): string {
  if (!started) return "—";
  const milliseconds = (finished ? new Date(finished).getTime() : Date.now()) - new Date(started).getTime();
  if (milliseconds < 0) return "—";
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function jobErrorText(error: unknown, fallback: string): string {
  return sanitizeJobDisplayText(error instanceof Error ? error.message : undefined, fallback, { maxBytes: 512, maxLines: 8 });
}

function isTrustedEventType(value: string): value is TrustedJobEventType {
  return (TRUSTED_JOB_EVENT_TYPES as readonly string[]).includes(value);
}

function eventLabel(eventType: TrustedJobEventType): string {
  switch (eventType) {
    case "context.conversation.archived": return "Conversation archived";
    case "context.conversation.unarchived": return "Conversation unarchived";
    case "context.checkpoint.restored_as_new": return "Checkpoint restored as new";
  }
}

function runStatusLabel(status: JobRun["status"]): string {
  switch (status) {
    case "success": return "Completed (succeeded)";
    case "queued": return "Queued";
    case "running": return "Running";
    case "failed": return "Failed";
    case "timeout": return "Timed out";
    case "cancelled": return "Cancelled";
  }
}

function runTriggerLabel(trigger: JobRun["trigger"]): string {
  return trigger === "manual" ? "Manual run" : trigger === "cron" ? "Scheduled run" : "Trusted event delivery";
}

function deliveryStateLabel(state: JobEventDeliveryState): string {
  return {
    queued: "Queued",
    leased: "Leased",
    retry_wait: "Retry waiting",
    succeeded: "Succeeded",
    dead_letter: "Dead letter",
  }[state];
}

function deliveryStateTone(state: JobEventDeliveryState): string {
  return badgeTones(state === "succeeded" ? "success" : state === "dead_letter" ? "error" : state === "retry_wait" ? "amber" : state === "leased" ? "blue" : "gray");
}

function agentBadgeColor(category: string): string {
  const hues: Record<string, string> = {
    orchestrator: "purple", execution: "blue", research: "green", security: "red", primary: "purple", qa: "green", docs: "amber", scout: "blue", explore: "teal",
  };
  return badgeTones(hues[category] ?? "gray");
}

function Timestamp({ value }: { value?: string | null }) {
  if (!value) return <span>—</span>;
  return <time dateTime={value} title={formatDate(value)}>{formatDate(value)}</time>;
}

function Identifier({ value, label }: { value: string; label: string }) {
  return <code className="text-xs" title={value} aria-label={`${label}: ${value}`}>{shortId(value)}</code>;
}

function Alert({ children }: { children: ReactNode }) {
  return <div role="alert" className="rounded border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-3 text-sm text-[var(--color-error-text)]">{children}</div>;
}

function RunStatusBadge({ status }: { status: JobRun["status"] }) {
  const tone = status === "success" ? "success" : status === "running" ? "blue" : status === "failed" || status === "timeout" ? "error" : status === "cancelled" ? "amber" : "gray";
  return <span className={`${BADGE_BASE} ${badgeTones(tone)}`}>{runStatusLabel(status)}</span>;
}

function EventTypeText({ eventType }: { eventType: TrustedJobEventType }) {
  return <span title={eventType}>{eventLabel(eventType)} <span className="text-xs text-[var(--color-text-muted)]">({eventType})</span></span>;
}

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
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  const legacyTrigger = initial?.trigger_event && !isTrustedEventType(initial.trigger_event) ? initial.trigger_event : null;

  useEffect(() => {
    setForm(initial ? {
      name: initial.name,
      description: initial.description ?? "",
      agent: initial.agent,
      prompt_template: initial.prompt_template,
      schedule_cron: initial.schedule_cron ?? "",
      trigger_event: initial.trigger_event ?? "",
      timeout_minutes: initial.timeout_minutes,
    } : EMPTY_FORM);
    setError(null);
    setSuggestionError(null);
    setSuggesting(false);
  }, [initial, isOpen]);

  const update = (field: keyof JobFormData, value: string | number) => setForm((current) => ({ ...current, [field]: value }));

  const suggest = async () => {
    if (!form.description.trim()) return;
    setSuggesting(true);
    setSuggestionError(null);
    try {
      const response = await api.jobs.suggest(form.description.trim(), project);
      if (!response.data.configured) {
        setSuggestionError("Configure a primary LLM provider in Settings → Providers to enable suggestions.");
        return;
      }
      setForm((current) => ({
        ...current,
        ...(response.data.prompt_template ? { prompt_template: response.data.prompt_template } : {}),
        ...(response.data.schedule_cron ? { schedule_cron: response.data.schedule_cron } : {}),
        ...(response.data.trigger_event && isTrustedEventType(response.data.trigger_event) ? { trigger_event: response.data.trigger_event } : {}),
      }));
      if (response.data.trigger_event && !isTrustedEventType(response.data.trigger_event)) {
        setSuggestionError("The suggestion used an unsupported event and was not applied.");
      }
    } catch (suggestionFailure: unknown) {
      setSuggestionError(`AI suggestion failed: ${jobErrorText(suggestionFailure, "Try again later.")}`);
    } finally {
      setSuggesting(false);
    }
  };

  const save = async () => {
    if (!form.name.trim() || !form.agent || !form.prompt_template.trim()) {
      setError("Name, agent, and prompt template are required.");
      return;
    }
    const triggerChanged = form.trigger_event !== (initial?.trigger_event ?? "");
    const trigger = isTrustedEventType(form.trigger_event) ? form.trigger_event : null;
    const data = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      agent: form.agent,
      prompt_template: form.prompt_template,
      schedule_cron: form.schedule_cron.trim() || undefined,
      timeout_minutes: form.timeout_minutes,
      ...(!legacyTrigger || triggerChanged ? { trigger_event: trigger } : {}),
    };
    setSaving(true);
    setError(null);
    try {
      const response = initial
        ? await api.jobs.update(initial.id, data, project)
        : await api.jobs.create(data, project);
      onSaved(response.data);
      onClose();
    } catch (saveFailure: unknown) {
      setError(`Job could not be saved: ${jobErrorText(saveFailure, "Save failed.")}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Overlay isOpen={isOpen} onClose={onClose} title={initial ? `Edit Job: ${initial.name}` : "Create Job"} subtitle="Configure a scheduled or trusted-event job">
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <label htmlFor="job-name" className="mb-1 block text-sm font-medium">Name *</label>
              <input id="job-name" value={form.name} onChange={(event) => update("name", event.target.value)} className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm" placeholder="e.g., Nightly Security Scan" />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between gap-3">
                <label htmlFor="job-description" className="text-sm font-medium">Description</label>
                <button type="button" onClick={() => void suggest()} disabled={suggesting || !form.description.trim()} className="text-xs text-[var(--color-text-link)] hover:underline disabled:cursor-not-allowed disabled:opacity-50">
                  {suggesting ? "Generating…" : "Auto-generate"}
                </button>
              </div>
              <textarea id="job-description" value={form.description} onChange={(event) => update("description", event.target.value)} className="min-h-[60px] w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm" placeholder="Describe what this job should do" />
              {suggestionError && <p role="status" className="mt-1 text-xs text-[var(--color-error-text)]">{suggestionError}</p>}
            </div>
            <div>
              <label htmlFor="job-agent" className="mb-1 block text-sm font-medium">Agent *</label>
              <Select id="job-agent" value={form.agent} onChange={(event) => update("agent", event.target.value)} className="w-full text-sm">
                <option value="">— Select agent —</option>
                {agents.map((agent) => <option key={agent.name} value={agent.name}>{agent.name}</option>)}
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="job-schedule" className="mb-1 block text-sm font-medium">Schedule (cron)</label>
                <input id="job-schedule" value={form.schedule_cron} onChange={(event) => update("schedule_cron", event.target.value)} className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-sm" placeholder="*/15 * * * *" />
                {form.schedule_cron.trim() && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{cronToHuman(form.schedule_cron)}</p>}
              </div>
              <div>
                <label htmlFor="job-timeout" className="mb-1 block text-sm font-medium">Timeout (minutes)</label>
                <input id="job-timeout" type="number" min={1} max={1440} value={form.timeout_minutes} onChange={(event) => update("timeout_minutes", Number.parseInt(event.target.value, 10) || 30)} className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm" />
              </div>
            </div>
            <div>
              <label htmlFor="job-trigger-event" className="mb-1 block text-sm font-medium">Trusted event trigger</label>
              <Select id="job-trigger-event" value={form.trigger_event} onChange={(event) => update("trigger_event", event.target.value)} aria-describedby="job-trigger-help job-trigger-legacy" className="w-full text-sm">
                <option value="">No event</option>
                {legacyTrigger && <option value={legacyTrigger} disabled>Legacy value preserved: {legacyTrigger}</option>}
                {TRUSTED_JOB_EVENT_TYPES.map((eventType) => <option key={eventType} value={eventType}>{eventLabel(eventType)}</option>)}
              </Select>
              <p id="job-trigger-help" className="mt-1 text-xs text-[var(--color-text-muted)]">Only trusted context maintenance events can start event-driven jobs. Run Now always starts a fresh manual run; it never replays an event delivery.</p>
              {legacyTrigger && <p id="job-trigger-legacy" className="mt-1 text-xs text-[var(--color-warning-text)]">Legacy trigger preserved. Choose No event or a trusted event to replace it; legacy values cannot be selected for new jobs.</p>}
            </div>
          </div>
          <div>
            <label htmlFor="job-prompt" className="mb-1 block text-sm font-medium">Prompt Template *</label>
            <textarea id="job-prompt" value={form.prompt_template} onChange={(event) => update("prompt_template", event.target.value)} className="min-h-[320px] w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-sm" placeholder="Write the prompt template. Use {{variable}} for dynamic values." rows={12} />
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-hover)]">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Saving…" : initial ? "Update Job" : "Create Job"}</button>
        </div>
      </div>
    </Overlay>
  );
}

function LiveLogConsole({ run, project, onError }: { run: JobRun; project: string; onError: (message: string) => void }) {
  const [logs, setLogs] = useState<JobRunLog[]>([]);
  const [pinned, setPinned] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const maxSequence = useRef<number | undefined>(undefined);

  useEffect(() => {
    setLogs([]);
    setError(null);
    maxSequence.current = undefined;
  }, [run.id]);

  useEffect(() => {
    let cancelled = false;
    const loadLogs = async () => {
      try {
        const response = await api.jobs.runLogs(run.id, maxSequence.current, project);
        if (cancelled || response.data.length === 0) return;
        maxSequence.current = Math.max(...response.data.map((entry) => entry.seq));
        setLogs((current) => {
          const existing = new Set(current.map((entry) => entry.id));
          return [...current, ...response.data.filter((entry) => !existing.has(entry.id))];
        });
        setError(null);
      } catch (logFailure: unknown) {
        if (cancelled) return;
        const message = `Run logs could not be loaded: ${jobErrorText(logFailure, "Try again shortly.")}`;
        setError(message);
        onError(message);
      }
    };
    void loadLogs();
    const interval = run.status === "running" ? window.setInterval(() => void loadLogs(), 2_000) : undefined;
    return () => {
      cancelled = true;
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [project, run.id, run.status, onError]);

  useEffect(() => {
    if (pinned && containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [logs, pinned]);

  return (
    <section aria-label="Run logs" className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Logs {run.status === "running" && <span className="text-xs text-[var(--color-text-muted)]">(live)</span>}</h3>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]"><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} className="rounded" />Pin to bottom</label>
      </div>
      {error && <Alert>{error}</Alert>}
      <div ref={containerRef} tabIndex={0} aria-label="Scrollable run logs" className="max-h-96 overflow-y-auto rounded bg-gray-900 p-4 font-mono text-xs text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]">
        {logs.length === 0 ? <p className="italic text-[var(--color-text-muted)]">Waiting for output…</p> : logs.map((log) => <div key={log.id} className="break-all whitespace-pre-wrap leading-relaxed"><span className={log.stream === "stderr" ? "text-red-400" : "text-green-400"}>[{log.seq}]</span> {log.line}</div>)}
      </div>
    </section>
  );
}

function RunDeliveryMetadata({ delivery }: { delivery: JobRun["event_delivery"] }) {
  if (!delivery) return null;
  return <span className="text-xs text-[var(--color-text-secondary)]">Delivery <Identifier value={delivery.delivery_id} label="Delivery ID" /> · event <Identifier value={delivery.trusted_event_id} label="Trusted event ID" /> · attempt {delivery.attempt_number} · {deliveryStateLabel(delivery.delivery_state)}</span>;
}

function JobDetailView({
  job,
  project,
  refreshToken,
  onBack,
  onEdit,
  onRun,
  onToggleEnabled,
  onDelete,
  onError,
}: {
  job: Job;
  project: string;
  refreshToken: number;
  onBack: () => void;
  onEdit: () => void;
  onRun: () => Promise<void>;
  onToggleEnabled: () => Promise<void>;
  onDelete: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<JobRun | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const response = await api.jobs.runs(job.id, project);
      setRuns(response.data ?? []);
      setSelectedRun((current) => current ? response.data.find((run) => run.id === current.id) ?? null : null);
    } catch (runsFailure: unknown) {
      onError(`Run history could not be loaded: ${jobErrorText(runsFailure, "Try again shortly.")}`);
    } finally {
      setLoadingRuns(false);
    }
  }, [job.id, onError, project]);

  const activeRun = selectedRun ?? runs.find((run) => run.status === "running") ?? null;

  useEffect(() => { void fetchRuns(); }, [fetchRuns, refreshToken]);

  useEffect(() => {
    if (!activeRun || activeRun.status !== "running") return;
    const interval = window.setInterval(() => void fetchRuns(), 2_000);
    return () => window.clearInterval(interval);
  }, [activeRun?.id, activeRun?.status, fetchRuns]);

  const cancelRun = async () => {
    if (!activeRun) return;
    setCancelling(true);
    try {
      await api.jobs.cancelRun(activeRun.id, project);
      await fetchRuns();
    } catch (cancelFailure: unknown) {
      onError(`Run could not be cancelled: ${jobErrorText(cancelFailure, "Try again shortly.")}`);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="job-detail">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">← Back to jobs</button>
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <h1 className="break-words text-xl font-bold text-[var(--color-text-primary)]">{job.name}</h1>
            {job.description && <p className="text-sm text-[var(--color-text-secondary)]">{job.description}</p>}
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <span className={`rounded px-2 py-0.5 font-medium ${agentBadgeColor(job.agent)}`}>{job.agent}</span>
              {job.schedule_cron && <span className="rounded bg-[var(--color-surface-muted)] px-2 py-0.5">{cronToHuman(job.schedule_cron)}</span>}
              {job.trigger_event && <span className="rounded bg-[var(--color-surface-muted)] px-2 py-0.5">{isTrustedEventType(job.trigger_event) ? eventLabel(job.trigger_event) : `Legacy trigger: ${job.trigger_event}`}</span>}
              <span>Timeout: {job.timeout_minutes} min</span>
            </div>
          </div>
          <label className="flex shrink-0 items-center gap-1.5 text-sm"><input type="checkbox" checked={job.enabled} onChange={() => void onToggleEnabled()} className="rounded" /><span className={job.enabled ? "text-[var(--color-success-text)]" : "text-[var(--color-text-muted)]"}>{job.enabled ? "Enabled" : "Disabled"}</span></label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void onRun()} className="rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700">Run Now</button>
          <button type="button" onClick={onEdit} className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">Edit</button>
          <button type="button" onClick={() => void onDelete()} className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700">Delete</button>
        </div>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">Run Now starts a fresh manual run. It does not replay event deliveries.</p>
        <div className="mt-4">
          <h2 className="mb-1 text-xs font-medium text-[var(--color-text-muted)]">Prompt Template</h2>
          <pre className="max-h-48 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 whitespace-pre-wrap break-words text-xs">{job.prompt_template}</pre>
        </div>
      </section>
      {activeRun && <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0"><h2 className="inline text-sm font-semibold text-[var(--color-text-primary)]">Run <Identifier value={activeRun.id} label="Run ID" /></h2> <RunStatusBadge status={activeRun.status} /> <RunDeliveryMetadata delivery={activeRun.event_delivery} /></div>
          <div className="flex gap-2">
            {activeRun.status === "running" && <button type="button" onClick={() => void cancelRun()} disabled={cancelling} className="rounded border border-[var(--color-error-border)] px-2 py-1 text-xs text-[var(--color-error-text)] hover:bg-[var(--color-error-bg)] disabled:cursor-not-allowed disabled:opacity-50">{cancelling ? "Cancelling…" : "Cancel Run"}</button>}
            {selectedRun && <button type="button" onClick={() => setSelectedRun(null)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">Close</button>}
          </div>
        </div>
        <LiveLogConsole run={activeRun} project={project} onError={onError} />
      </section>}
      <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:shadow-md transition-shadow">
        <div className="border-b border-[var(--color-border)] px-4 py-3"><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Run History ({runs.length})</h2></div>
        {loadingRuns && runs.length === 0 ? <p role="status" className="p-4 text-sm text-[var(--color-text-muted)]">Loading run history…</p> : runs.length === 0 ? <p className="p-4 text-sm italic text-[var(--color-text-muted)]">No runs yet.</p> : <>
          <div tabIndex={0} role="region" aria-label="Run history" className="hidden overflow-x-auto focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] md:block">
            <table aria-label="Run history" className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b border-[var(--color-border-muted)] text-left text-xs text-[var(--color-text-muted)]"><th scope="col" className="px-4 py-2">ID</th><th scope="col" className="px-4 py-2">Status</th><th scope="col" className="px-4 py-2">Trigger</th><th scope="col" className="px-4 py-2">Delivery</th><th scope="col" className="px-4 py-2">Started</th><th scope="col" className="px-4 py-2">Duration</th></tr></thead>
              <tbody>{runs.map((run) => <tr key={run.id} className={`border-b border-[var(--color-border-muted)] ${selectedRun?.id === run.id ? "bg-[var(--color-surface-selected)]" : "hover:bg-[var(--color-surface-hover)]"}`}>
                <td className="px-4 py-2"><button type="button" onClick={() => setSelectedRun(run)} aria-pressed={selectedRun?.id === run.id} aria-label={`Open run ${run.id}`} className="rounded text-left focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"><Identifier value={run.id} label="Run ID" /></button></td>
                <td className="px-4 py-2"><RunStatusBadge status={run.status} /></td><td className="px-4 py-2">{runTriggerLabel(run.trigger)}</td><td className="px-4 py-2"><RunDeliveryMetadata delivery={run.event_delivery} /></td><td className="px-4 py-2 text-xs text-[var(--color-text-muted)]"><Timestamp value={run.started_at} /></td><td className="px-4 py-2 text-[var(--color-text-muted)]">{duration(run.started_at, run.finished_at)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div data-testid="run-history-mobile-cards" className="space-y-2 p-3 md:hidden">{runs.map((run) => <button key={run.id} type="button" onClick={() => setSelectedRun(run)} aria-pressed={selectedRun?.id === run.id} aria-label={`Open run ${run.id}`} className={`w-full rounded border border-[var(--color-border)] p-3 text-left focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] ${selectedRun?.id === run.id ? "bg-[var(--color-surface-selected)]" : "bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]"}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">Run <Identifier value={run.id} label="Run ID" /></span><RunStatusBadge status={run.status} /></div><div className="mt-2 text-xs text-[var(--color-text-secondary)]">{runTriggerLabel(run.trigger)} · {duration(run.started_at, run.finished_at)}</div><RunDeliveryMetadata delivery={run.event_delivery} /></button>)}</div>
        </>}
      </section>
    </div>
  );
}

function deliveryTiming(delivery: JobEventDelivery) {
  if (delivery.state === "leased") return <><span>Lease expires: </span><Timestamp value={delivery.lease_expires_at} /></>;
  if (delivery.state === "retry_wait") return <><span>Next retry: </span><Timestamp value={delivery.next_attempt_at} /></>;
  if (delivery.state === "queued") return <><span>Ready: </span><Timestamp value={delivery.next_attempt_at} /></>;
  return "—";
}

function EventQueueTab({ project, refreshToken }: { project: string; refreshToken: number }) {
  const [deliveries, setDeliveries] = useState<JobEventDelivery[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stateFilter, setStateFilter] = useState<JobEventDeliveryState | "">("");
  const [typeFilter, setTypeFilter] = useState<TrustedJobEventType | "">("");
  const [jobFilter, setJobFilter] = useState("");
  const requestVersion = useRef(0);
  const refreshing = useRef(false);
  const loadingMoreRef = useRef(false);
  const seenRefreshToken = useRef(refreshToken);

  const loadFirst = useCallback(async (background = false) => {
    if (refreshing.current) return;
    refreshing.current = true;
    const version = ++requestVersion.current;
    if (!background) {
      setLoading(true);
      setFatalError(null);
      setLoadMoreError(null);
    }
    try {
      const response = await api.jobs.eventDeliveries(project, { limit: PAGE_LIMIT });
      if (version !== requestVersion.current) return;
      setDeliveries(response.data);
      setCursor(response.nextCursor);
      setRefreshError(null);
    } catch (queueFailure: unknown) {
      if (version !== requestVersion.current) return;
      const message = `Event queue could not be loaded: ${jobErrorText(queueFailure, "Try again shortly.")}`;
      if (background) setRefreshError(message);
      else setFatalError(message);
    } finally {
      if (version === requestVersion.current) setLoading(false);
      refreshing.current = false;
    }
  }, [project]);

  useEffect(() => {
    void loadFirst();
    return () => { requestVersion.current += 1; };
  }, [loadFirst]);

  useEffect(() => {
    if (seenRefreshToken.current === refreshToken) return;
    seenRefreshToken.current = refreshToken;
    void loadFirst(true);
  }, [loadFirst, refreshToken]);

  const activeDeliveryExists = deliveries.some((delivery) => delivery.state === "queued" || delivery.state === "leased" || delivery.state === "retry_wait");
  useEffect(() => {
    if (!activeDeliveryExists) return;
    const interval = window.setInterval(() => {
      if (!loadingMoreRef.current) void loadFirst(true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [activeDeliveryExists, loadFirst]);

  const loadMore = async () => {
    if (!cursor || loadingMoreRef.current) return;
    const pageCursor = cursor;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const response = await api.jobs.eventDeliveries(project, { limit: PAGE_LIMIT, cursor: pageCursor });
      setDeliveries((current) => {
        const known = new Set(current.map((delivery) => delivery.id));
        return [...current, ...response.data.filter((delivery) => !known.has(delivery.id))];
      });
      setCursor(response.nextCursor);
    } catch (moreFailure: unknown) {
      setLoadMoreError(`More event deliveries could not be loaded: ${jobErrorText(moreFailure, "Try again shortly.")}`);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  const jobs = useMemo(() => Array.from(new Map(deliveries.map((delivery) => [delivery.job_id, delivery.job_name])).entries()), [deliveries]);
  const visibleDeliveries = useMemo(() => deliveries.filter((delivery) => (!stateFilter || delivery.state === stateFilter) && (!typeFilter || delivery.event_type === typeFilter) && (!jobFilter || delivery.job_id === jobFilter)), [deliveries, jobFilter, stateFilter, typeFilter]);

  return (
    <section className="space-y-4" data-testid="event-queue-panel">
      <div>
        <h2 className="text-xl font-bold text-[var(--color-text-primary)]">Event queue — loaded results ({visibleDeliveries.length})</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Trusted event deliveries retry up to five attempts. A dead-letter delivery is terminal and cannot be replayed here.</p>
      </div>
      <div className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:grid-cols-3 hover:shadow-md transition-shadow" aria-label="Loaded event queue filters">
        <div><label htmlFor="queue-state" className="mb-1 block text-xs font-medium">State</label><Select id="queue-state" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as JobEventDeliveryState | "")} className="w-full text-sm"><option value="">All loaded states</option>{(["queued", "leased", "retry_wait", "succeeded", "dead_letter"] as const).map((state) => <option key={state} value={state}>{deliveryStateLabel(state)}</option>)}</Select></div>
        <div><label htmlFor="queue-type" className="mb-1 block text-xs font-medium">Event type</label><Select id="queue-type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as TrustedJobEventType | "")} className="w-full text-sm"><option value="">All loaded event types</option>{TRUSTED_JOB_EVENT_TYPES.map((eventType) => <option key={eventType} value={eventType}>{eventLabel(eventType)}</option>)}</Select></div>
        <div><label htmlFor="queue-job" className="mb-1 block text-xs font-medium">Job</label><Select id="queue-job" value={jobFilter} onChange={(event) => setJobFilter(event.target.value)} className="w-full text-sm"><option value="">All loaded jobs</option>{jobs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></div>
      </div>
      {refreshError && <p role="status" aria-live="polite" className="text-sm text-[var(--color-warning-text)]">{refreshError}</p>}
      {loading && deliveries.length === 0 && <p data-testid="event-queue-loading" role="status" className="text-sm text-[var(--color-text-muted)]">Loading event queue…</p>}
      {!loading && fatalError && deliveries.length === 0 && <section data-testid="event-queue-error" className="rounded-lg border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-6 text-center hover:shadow-md transition-shadow" role="alert"><h3 className="font-semibold text-[var(--color-error-text)]">Unable to load the event queue</h3><p className="mt-2 text-sm text-[var(--color-text-secondary)]">{fatalError}</p><button type="button" onClick={() => void loadFirst()} className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">Retry</button></section>}
      {!loading && !fatalError && deliveries.length === 0 && <p data-testid="event-queue-empty" className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-text-muted)] hover:shadow-md transition-shadow">No event deliveries have been loaded for this project.</p>}
      {deliveries.length > 0 && <>
        {visibleDeliveries.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">No loaded results match these filters.</p> : <>
          <div data-testid="event-queue-table" tabIndex={0} role="region" aria-label="Event queue loaded results table" className="hidden overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] md:block"><table aria-label="Event queue loaded results table" className="w-full min-w-[1050px] text-sm"><thead><tr className="border-b border-[var(--color-border-muted)] text-left text-xs text-[var(--color-text-muted)]"><th scope="col" className="px-3 py-2">Job / event</th><th scope="col" className="px-3 py-2">State</th><th scope="col" className="px-3 py-2">Attempts</th><th scope="col" className="px-3 py-2">Retry / lease timing</th><th scope="col" className="px-3 py-2">Last error</th><th scope="col" className="px-3 py-2">Created / updated</th></tr></thead><tbody>{visibleDeliveries.map((delivery) => <tr key={delivery.id} className="border-b border-[var(--color-border-muted)] align-top"><td className="px-3 py-3"><div className="font-medium">{delivery.job_name}</div><EventTypeText eventType={delivery.event_type} /><div className="mt-1 text-[var(--color-text-muted)]"><Identifier value={delivery.id} label="Delivery ID" /></div></td><td className="px-3 py-3"><span className={`${BADGE_BASE} ${deliveryStateTone(delivery.state)}`}>{deliveryStateLabel(delivery.state)}</span></td><td className="px-3 py-3">{delivery.attempt_count} / 5</td><td className="px-3 py-3 text-xs text-[var(--color-text-secondary)]">{deliveryTiming(delivery)}</td><td className="max-w-xs break-words px-3 py-3 text-xs text-[var(--color-text-secondary)]">{delivery.last_error_code && <div>{delivery.last_error_code}</div>}{delivery.last_error_message ?? "—"}</td><td className="px-3 py-3 text-xs text-[var(--color-text-muted)]"><div><Timestamp value={delivery.created_at} /></div><div><Timestamp value={delivery.updated_at} /></div></td></tr>)}</tbody></table></div>
          <div data-testid="event-queue-mobile-cards" className="space-y-3 md:hidden">{visibleDeliveries.map((delivery) => <article key={delivery.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words font-semibold">{delivery.job_name}</h3><EventTypeText eventType={delivery.event_type} /></div><span className={`${BADGE_BASE} ${deliveryStateTone(delivery.state)}`}>{deliveryStateLabel(delivery.state)}</span></div><dl className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-[var(--color-text-muted)]">Attempts</dt><dd>{delivery.attempt_count} / 5</dd></div><div><dt className="text-[var(--color-text-muted)]">Timing</dt><dd>{deliveryTiming(delivery)}</dd></div><div><dt className="text-[var(--color-text-muted)]">Delivery ID</dt><dd><Identifier value={delivery.id} label="Delivery ID" /></dd></div><div><dt className="text-[var(--color-text-muted)]">Updated</dt><dd><Timestamp value={delivery.updated_at} /></dd></div></dl>{delivery.last_error_message && <p className="mt-3 break-words text-xs text-[var(--color-text-secondary)]">Last error: {delivery.last_error_message}</p>}</article>)}</div>
        </>}
        {loadMoreError && <Alert>{loadMoreError}</Alert>}
        {cursor && <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50">{loadingMore ? "Loading more…" : "Load more loaded results"}</button>}
      </>}
    </section>
  );
}

function TrustedEventsTab({ project }: { project: string }) {
  const [events, setEvents] = useState<TrustedJobEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TrustedJobEventType | "">("");
  const [idFilter, setIdFilter] = useState("");
  const requestVersion = useRef(0);

  const loadFirst = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setFatalError(null);
    setLoadMoreError(null);
    try {
      const response = await api.jobs.trustedEvents(project, { limit: PAGE_LIMIT });
      if (version !== requestVersion.current) return;
      setEvents(response.data);
      setCursor(response.nextCursor);
    } catch (eventsFailure: unknown) {
      if (version === requestVersion.current) setFatalError(`Trusted events could not be loaded: ${jobErrorText(eventsFailure, "Try again shortly.")}`);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [project]);

  useEffect(() => { void loadFirst(); return () => { requestVersion.current += 1; }; }, [loadFirst]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    const pageCursor = cursor;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const response = await api.jobs.trustedEvents(project, { limit: PAGE_LIMIT, cursor: pageCursor });
      setEvents((current) => {
        const known = new Set(current.map((event) => event.id));
        return [...current, ...response.data.filter((event) => !known.has(event.id))];
      });
      setCursor(response.nextCursor);
    } catch (moreFailure: unknown) {
      setLoadMoreError(`More trusted events could not be loaded: ${jobErrorText(moreFailure, "Try again shortly.")}`);
    } finally {
      setLoadingMore(false);
    }
  };

  const visibleEvents = useMemo(() => events.filter((event) => (!typeFilter || event.event_type === typeFilter) && (!idFilter || event.id.toLowerCase().includes(idFilter.toLowerCase()))), [events, idFilter, typeFilter]);

  return (
    <section className="space-y-4" data-testid="trusted-events-panel">
      <div><h2 className="text-xl font-bold text-[var(--color-text-primary)]">Trusted events — loaded results ({visibleEvents.length})</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">This audit view intentionally shows only trusted event metadata.</p></div>
      <div className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:grid-cols-2 hover:shadow-md transition-shadow" aria-label="Loaded trusted event filters">
        <div><label htmlFor="events-type" className="mb-1 block text-xs font-medium">Event type</label><Select id="events-type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as TrustedJobEventType | "")} className="w-full text-sm"><option value="">All loaded event types</option>{TRUSTED_JOB_EVENT_TYPES.map((eventType) => <option key={eventType} value={eventType}>{eventLabel(eventType)}</option>)}</Select></div>
        <div><label htmlFor="events-id" className="mb-1 block text-xs font-medium">Event ID contains</label><input id="events-id" value={idFilter} onChange={(event) => setIdFilter(event.target.value)} className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" /></div>
      </div>
      {loading && events.length === 0 && <p data-testid="trusted-events-loading" role="status" className="text-sm text-[var(--color-text-muted)]">Loading trusted events…</p>}
      {!loading && fatalError && events.length === 0 && <section data-testid="trusted-events-error" className="rounded-lg border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-6 text-center hover:shadow-md transition-shadow" role="alert"><h3 className="font-semibold text-[var(--color-error-text)]">Unable to load trusted events</h3><p className="mt-2 text-sm text-[var(--color-text-secondary)]">{fatalError}</p><button type="button" onClick={() => void loadFirst()} className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">Retry</button></section>}
      {!loading && !fatalError && events.length === 0 && <p data-testid="trusted-events-empty" className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-text-muted)] hover:shadow-md transition-shadow">No trusted events have been loaded for this project.</p>}
      {events.length > 0 && <>{visibleEvents.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">No loaded results match these filters.</p> : <><div data-testid="trusted-events-table" tabIndex={0} role="region" aria-label="Trusted events loaded results table" className="hidden overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] md:block"><table aria-label="Trusted events loaded results table" className="w-full min-w-[760px] text-sm"><thead><tr className="border-b border-[var(--color-border-muted)] text-left text-xs text-[var(--color-text-muted)]"><th scope="col" className="px-3 py-2">Event type</th><th scope="col" className="px-3 py-2">Event ID</th><th scope="col" className="px-3 py-2">Source audit ID</th><th scope="col" className="px-3 py-2">Timestamp</th></tr></thead><tbody>{visibleEvents.map((event) => <tr key={event.id} className="border-b border-[var(--color-border-muted)]"><td className="px-3 py-3"><EventTypeText eventType={event.event_type} /></td><td className="px-3 py-3"><Identifier value={event.id} label="Trusted event ID" /></td><td className="px-3 py-3"><Identifier value={event.source_audit_event_id} label="Source audit ID" /></td><td className="px-3 py-3 text-xs text-[var(--color-text-muted)]"><Timestamp value={event.created_at} /></td></tr>)}</tbody></table></div><div data-testid="trusted-events-mobile-cards" className="space-y-3 md:hidden">{visibleEvents.map((event) => <article key={event.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow"><h3 className="font-semibold"><EventTypeText eventType={event.event_type} /></h3><dl className="mt-3 space-y-2 text-xs"><div><dt className="text-[var(--color-text-muted)]">Event ID</dt><dd><Identifier value={event.id} label="Trusted event ID" /></dd></div><div><dt className="text-[var(--color-text-muted)]">Source audit ID</dt><dd><Identifier value={event.source_audit_event_id} label="Source audit ID" /></dd></div><div><dt className="text-[var(--color-text-muted)]">Timestamp</dt><dd><Timestamp value={event.created_at} /></dd></div></dl></article>)}</div></>}{loadMoreError && <Alert>{loadMoreError}</Alert>}{cursor && <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50">{loadingMore ? "Loading more…" : "Load more loaded results"}</button>}</>}
    </section>
  );
}

function JobCard({ job, onOpen, onRun, onToggleEnabled, getLastRunStatus }: { job: Job; onOpen: () => void; onRun: () => void; onToggleEnabled: () => void; getLastRunStatus: (id: string) => Promise<JobRun["status"] | null> }) {
  const [lastStatus, setLastStatus] = useState<JobRun["status"] | null>(null);
  useEffect(() => { void getLastRunStatus(job.id).then(setLastStatus); }, [getLastRunStatus, job.id]);
  return <article className="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow"><div className="flex items-start justify-between gap-2"><button type="button" onClick={onOpen} className="min-w-0 text-left"><h2 className="truncate text-lg font-semibold text-[var(--color-text-primary)]">{job.name}</h2><span className="sr-only">Open job {job.name}</span></button><div className="flex shrink-0 items-center gap-2">{lastStatus && <span className={`h-3 w-3 rounded-full ${lastStatus === "success" ? "bg-green-500" : lastStatus === "running" ? "animate-pulse bg-[var(--color-accent)]" : lastStatus === "failed" || lastStatus === "timeout" ? "bg-red-500" : "bg-gray-400"}`} title={runStatusLabel(lastStatus)} />}<button type="button" onClick={onRun} aria-label={`Run ${job.name} now`} className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-success-bg)] hover:text-[var(--color-success-text)]">▶</button></div></div>{job.description && <p className="mt-2 line-clamp-2 text-sm text-[var(--color-text-secondary)]">{job.description}</p>}<div className="mt-3 flex flex-wrap items-center gap-2"><span className={`rounded px-2 py-0.5 text-xs font-medium ${agentBadgeColor(job.agent)}`}>{job.agent}</span>{job.schedule_cron && <span className="text-xs text-[var(--color-text-muted)]">Runs: {cronToHuman(job.schedule_cron)}</span>}</div><div className="mt-3 flex items-center justify-between border-t border-[var(--color-border-muted)] pt-3"><label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={job.enabled} onChange={onToggleEnabled} className="rounded" /><span className={job.enabled ? "text-xs text-[var(--color-success-text)]" : "text-xs text-[var(--color-text-muted)]"}>{job.enabled ? "Enabled" : "Disabled"}</span></label><span className="text-xs text-[var(--color-text-muted)]">Timeout: {job.timeout_minutes}m</span></div></article>;
}

export default function JobsPage() {
  const project = useProject();
  const [tab, setTab] = useState<JobsTab>("jobs");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | undefined>();
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deliveryRefreshToken, setDeliveryRefreshToken] = useState(0);
  const detailRefreshToken = useRef(0);
  const tabRefs = useRef<Record<JobsTab, HTMLButtonElement | null>>({ jobs: null, queue: null, events: null });

  const reportError = useCallback((message: string) => setError(sanitizeJobDisplayText(message, "Job request failed.", { maxBytes: 512, maxLines: 8 })), []);

  const fetchJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const response = await api.jobs.list(project);
      setJobs(response.data ?? []);
    } catch (listFailure: unknown) {
      reportError(`Jobs could not be loaded: ${jobErrorText(listFailure, "Try again shortly.")}`);
    } finally {
      setLoadingJobs(false);
    }
  }, [project, reportError]);

  useEffect(() => {
    setSelectedJob(null);
    setError(null);
    void fetchJobs();
    void api.agents.list(project).then((response) => setAgents(response.data ?? [])).catch((agentsFailure: unknown) => reportError(`Agents could not be loaded: ${jobErrorText(agentsFailure, "Try again shortly.")}`));
  }, [fetchJobs, project, reportError]);

  const sortedJobs = useMemo(() => [...jobs].sort((left, right) => Number(right.enabled) - Number(left.enabled) || left.name.localeCompare(right.name)), [jobs]);

  const runJob = useCallback(async (job: Job) => {
    setError(null);
    try {
      await api.jobs.run(job.id, project);
      await fetchJobs();
      detailRefreshToken.current += 1;
    } catch (runFailure: unknown) {
      reportError(`Job could not be started: ${jobErrorText(runFailure, "Try again shortly.")}`);
    }
  }, [fetchJobs, project, reportError]);

  const toggleJob = useCallback(async (job: Job) => {
    setError(null);
    try {
      const response = await api.jobs.update(job.id, { enabled: !job.enabled }, project);
      setJobs((current) => current.map((entry) => entry.id === job.id ? response.data : entry));
      setSelectedJob((current) => current?.id === job.id ? response.data : current);
    } catch (toggleFailure: unknown) {
      reportError(`Job could not be ${job.enabled ? "disabled" : "enabled"}: ${jobErrorText(toggleFailure, "Try again shortly.")}`);
    }
  }, [project, reportError]);

  const refreshActiveDelivery = useCallback(async (job: Job) => {
    try {
      await Promise.all([api.jobs.runs(job.id, project), api.jobs.eventDeliveries(project, { limit: PAGE_LIMIT })]);
      detailRefreshToken.current += 1;
      setDeliveryRefreshToken((current) => current + 1);
    } catch (refreshFailure: unknown) {
      reportError(`The job remains open, but current delivery status could not be refreshed: ${jobErrorText(refreshFailure, "Try again shortly.")}`);
    }
  }, [project, reportError]);

  const deleteJob = useCallback(async (job: Job) => {
    if (!window.confirm(`Delete job "${job.name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await api.jobs.delete(job.id, project);
      setSelectedJob(null);
      await fetchJobs();
    } catch (deleteFailure: unknown) {
      if (deleteFailure instanceof ApiError && deleteFailure.status === 409) {
        reportError("This job cannot be deleted while an event delivery is active. Wait for the delivery to reach a terminal state, then try again.");
        await refreshActiveDelivery(job);
        return;
      }
      reportError(`Job could not be deleted: ${jobErrorText(deleteFailure, "Try again shortly.")}`);
    }
  }, [fetchJobs, project, refreshActiveDelivery, reportError]);

  const getLastRunStatus = useCallback(async (jobId: string): Promise<JobRun["status"] | null> => {
    try {
      return (await api.jobs.runs(jobId, project, 1)).data[0]?.status ?? null;
    } catch (runFailure: unknown) {
      reportError(`Latest run status could not be loaded: ${jobErrorText(runFailure, "Try again shortly.")}`);
      return null;
    }
  }, [project, reportError]);

  const selectTab = (next: JobsTab, focus = false) => {
    setTab(next);
    setSelectedJob(null);
    if (focus) window.requestAnimationFrame(() => tabRefs.current[next]?.focus());
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: JobsTab) => {
    const currentIndex = TABS.indexOf(current);
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (currentIndex + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    selectTab(TABS[index]!, true);
  };

  const tabLabel: Record<JobsTab, string> = { jobs: "Jobs", queue: "Event queue", events: "Trusted events" };
  return (
    <div className="space-y-5" data-testid="jobs-page">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-3xl font-bold text-[var(--color-text-primary)]">Jobs</h1><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Scheduled jobs, trusted event delivery visibility, and run history for {project}.</p></div>{tab === "jobs" && !selectedJob && <button type="button" onClick={() => { setEditingJob(undefined); setShowForm(true); }} className="w-full shrink-0 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 sm:w-auto">Create Job</button>}</header>
      <div role="tablist" aria-label="Jobs workspace views" className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-1">{TABS.map((item) => <button key={item} ref={(element) => { tabRefs.current[item] = element; }} type="button" id={`jobs-tab-${item}`} role="tab" aria-selected={tab === item} aria-controls={`jobs-panel-${item}`} tabIndex={tab === item ? 0 : -1} onClick={() => selectTab(item)} onKeyDown={(event) => onTabKeyDown(event, item)} className={`shrink-0 rounded px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] ${tab === item ? "bg-blue-600 text-white" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"}`}>{tabLabel[item]}</button>)}</div>
      {error && <Alert>{error}</Alert>}
      {tab === "jobs" && <section id="jobs-panel-jobs" role="tabpanel" aria-labelledby="jobs-tab-jobs">{selectedJob ? <JobDetailView key={selectedJob.id} job={selectedJob} project={project} refreshToken={detailRefreshToken.current} onBack={() => setSelectedJob(null)} onEdit={() => { setEditingJob(selectedJob); setShowForm(true); }} onRun={() => runJob(selectedJob)} onToggleEnabled={() => toggleJob(selectedJob)} onDelete={() => deleteJob(selectedJob)} onError={reportError} /> : loadingJobs ? <p role="status" className="text-sm text-[var(--color-text-muted)]">Loading jobs…</p> : sortedJobs.length === 0 ? <div className="py-12 text-center text-[var(--color-text-muted)]"><p className="text-lg font-semibold">No jobs yet</p><p className="mt-1 text-sm">Create a job to schedule agent runs.</p></div> : <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{sortedJobs.map((job) => <JobCard key={job.id} job={job} onOpen={() => setSelectedJob(job)} onRun={() => void runJob(job)} onToggleEnabled={() => void toggleJob(job)} getLastRunStatus={getLastRunStatus} />)}</div>}</section>}
      {tab === "queue" && <section id="jobs-panel-queue" role="tabpanel" aria-labelledby="jobs-tab-queue"><EventQueueTab project={project} refreshToken={deliveryRefreshToken} /></section>}
      {tab === "events" && <section id="jobs-panel-events" role="tabpanel" aria-labelledby="jobs-tab-events"><TrustedEventsTab project={project} /></section>}
      {showForm && <JobFormOverlay isOpen={showForm} onClose={() => { setShowForm(false); setEditingJob(undefined); }} initial={editingJob} agents={agents} project={project} onSaved={(saved) => { if (editingJob && saved) setSelectedJob(saved); void fetchJobs(); }} />}
    </div>
  );
}
