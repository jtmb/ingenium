"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useGlobalProject, useProject } from "../../lib/ProjectContext";
import { api, type PipelineEvent } from "../../lib/api";
import Overlay from "../components/Overlay";
import { badgeTones, BADGE_BASE } from "@/lib/badgeTones";
import { formatRelativeTime } from "@/lib/time";

const SOURCE_DOT: Record<string, string> = {
  agent: "bg-amber-500",
  plugin: "bg-[var(--color-accent)]",
  synthesis: "bg-emerald-500",
  system: "bg-gray-400",
};

const SOURCE_LINE: Record<string, string> = {
  agent: "bg-amber-300",
  plugin: "bg-blue-300",
  synthesis: "bg-emerald-300",
  system: "bg-gray-300",
};

const SOURCE_BADGE: Record<string, string> = {
  agent: badgeTones("amber"),
  plugin: badgeTones("blue"),
  synthesis: badgeTones("emerald"),
  system: badgeTones("gray"),
};

const SOURCE_LABEL: Record<string, string> = {
  agent: "Agent",
  plugin: "Plugin",
  synthesis: "Synthesis",
  system: "System",
};

const EVENT_ICON: Record<string, string> = {
  session_created: "\u25CB",   // ○
  session_idle: "\u25CC",      // ◌
  observation_created: "\u25CF", // ●
  observation_imported: "\u25CE", // ◎
  synthesis_triggered: "\u25C7", // ◇
  synthesis_started: "\u25B6",   // ▶
  synthesis_completed: "\u25C6", // ◆
  synthesis_failed: "\u2717",    // ✗
  trait_created: "\u25B8",       // ▸
  trait_updated: "\u25B9",       // ▹
  plugin_initialized: "\u25C7",  // ◇
  plugin_error: "\u26A0",        // ⚠
};

const EVENT_TYPE_LABEL: Record<string, string> = {
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

// 60-second window for collapsing consecutive observation_created events
// into a single timeline entry with a "+N" badge. Prevents the timeline
// from being dominated by rapid-fire observations during busy sessions.
const WINDOW_MS = 60_000;

function fmtAbs(iso: string): string {
  return new Date(iso).toLocaleString();
}

function parseData(raw: any): any {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

interface CollapsedGroup {
  events: PipelineEvent[];
  windowKey: string;
  source: string;
  firstTs: string;
}

type DisplayItem =
  | { kind: "single"; event: PipelineEvent }
  | { kind: "collapsed"; group: CollapsedGroup };

type FilterMode = "all" | "agent" | "plugin" | "synthesis" | "trait";
type LoadState = "loading" | "success" | "error";
type PipelineRequest = { project: string; filterMode: FilterMode; requestId: number };

/**
 * PipelinePage — Git-workflow-style timeline of pipeline events.
 *
 * Displays a vertical timeline with event dots, source badges, and
 * relative timestamps. observation_created events are auto-collapsed
 * into "+N" groups within 60-second windows to avoid visual noise.
 *
 * The synthesis countdown widget estimates time until the next scheduled
 * synthesis run by finding the last synthesis_completed event and applying
 * the configured `synthesis_interval_ms`. This is an estimate, not a
 * guaranteed schedule — the actual timer lives in the API process.
 *
 * Polls every 3s for new events (faster for the timeline than the 2s logs
 * because pipeline events are lower volume and the timeline is the primary
 * debugging surface).
 */
export default function PipelinePage() {
  const project = useProject();
  const { project: globalProject, loading: globalProjectLoading, error: globalProjectError } = useGlobalProject();
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [eventsState, setEventsState] = useState<LoadState>("loading");
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [selected, setSelected] = useState<any>(null);
  const [paused, setPaused] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [nextRun, setNextRun] = useState("");
  const [intervalMs, setIntervalMs] = useState<number | null>(null);
  const [scheduleState, setScheduleState] = useState<LoadState>("loading");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const eventsInFlightRef = useRef(false);
  const queuedRequestRef = useRef<PipelineRequest | null>(null);
  const latestRequestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIntervalMs(null);
    setScheduleError(null);

    if (globalProjectLoading) {
      setScheduleState("loading");
      return () => { cancelled = true; };
    }
    if (!globalProject) {
      setScheduleError(globalProjectError?.message ?? "No active global project is configured");
      setScheduleState("error");
      return () => { cancelled = true; };
    }

    setScheduleState("loading");
    api.settings.get("synthesis_interval_ms", globalProject)
      .then((response) => {
        const value = Number(response.data?.value);
        if (!Number.isFinite(value) || value < 0) throw new Error("Invalid synthesis schedule response");
        if (cancelled) return;
        setIntervalMs(value);
        setScheduleState("success");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setScheduleError(error instanceof Error ? error.message : "Unable to load synthesis schedule");
        setScheduleState("error");
      });

    return () => { cancelled = true; };
  }, [globalProject, globalProjectError, globalProjectLoading]);

  useEffect(() => {
    if (scheduleState !== "success" || intervalMs === null) {
      setNextRun("");
      return;
    }
    if (intervalMs <= 0) { setNextRun("disabled"); return; }
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
  }, [events, intervalMs, scheduleState]);

  const queueEvents = useCallback((request: PipelineRequest) => {
    queuedRequestRef.current = request;
    if (eventsInFlightRef.current) return;
    eventsInFlightRef.current = true;

    void (async () => {
      while (queuedRequestRef.current) {
        const currentRequest = queuedRequestRef.current;
        queuedRequestRef.current = null;
        const source = currentRequest.filterMode === "agent" || currentRequest.filterMode === "plugin" || currentRequest.filterMode === "synthesis"
          ? currentRequest.filterMode
          : undefined;

        try {
          const response = await api.pipeline.events(currentRequest.project, {
            limit: 500,
            ...(source ? { source } : {}),
          });
          if (!mountedRef.current || latestRequestIdRef.current !== currentRequest.requestId) continue;
          let data = Array.isArray(response.data) ? response.data as PipelineEvent[] : [];
          if (currentRequest.filterMode === "trait") {
            data = data.filter((event) => event.event_type === "trait_created" || event.event_type === "trait_updated");
          }
          setEvents(data);
          setEventsError(null);
          setEventsState("success");
        } catch (error: unknown) {
          if (!mountedRef.current || latestRequestIdRef.current !== currentRequest.requestId) continue;
          setEvents([]);
          setEventsError(error instanceof Error ? error.message : "Unable to load pipeline events");
          setEventsState("error");
        }
      }
      eventsInFlightRef.current = false;
    })();
  }, []);

  useEffect(() => {
    const request = {
      project,
      filterMode,
      requestId: latestRequestIdRef.current + 1,
    };
    latestRequestIdRef.current = request.requestId;
    setEvents([]);
    setEventsError(null);
    setEventsState("loading");
    queueEvents(request);
  }, [filterMode, project, queueEvents]);

  useEffect(() => {
    if (paused) return;
    const interval = setInterval(() => {
      queueEvents({ project, filterMode, requestId: latestRequestIdRef.current });
    }, 3_000);
    return () => clearInterval(interval);
  }, [filterMode, paused, project, queueEvents]);

  const stats = useMemo(
    () => ({
      total: events.length,
      observations: events.filter((e) => e.event_type === "observation_created").length,
      syntheses: events.filter((e) => e.event_type.startsWith("synthesis_")).length,
      traits: events.filter((e) => e.event_type.startsWith("trait_")).length,
      skills: events.filter((e) => {
        if (e.event_type === "trait_created" || e.event_type === "trait_updated") {
          const data = parseData(e.data);
          return Boolean(data && typeof data === "object" && ("skill_name" in data || "via_llm" in data));
        }
        return false;
      }).length,
    }),
    [events],
  );

  const childMap = useMemo(() => {
    const map = new Map<number, PipelineEvent[]>();
    for (const e of events) {
      if (e.parent_event_id != null) {
        const arr = map.get(e.parent_event_id) || [];
        arr.push(e);
        map.set(e.parent_event_id, arr);
      }
    }
    return map;
  }, [events]);

  const displayItems: DisplayItem[] = useMemo(() => {
    const items: DisplayItem[] = [];
    let i = 0;
    while (i < events.length) {
      const event = events[i]!;
      if (event.event_type === "observation_created") {
        const ts = new Date(event.created_at).getTime();
        const key = `${event.event_source}_${Math.floor(ts / WINDOW_MS)}`;
        const group: PipelineEvent[] = [];
        let j = i;
        while (j < events.length) {
          const e = events[j]!;
          if (e.event_type !== "observation_created") break;
          const eTs = new Date(e.created_at).getTime();
          if (`${e.event_source}_${Math.floor(eTs / WINDOW_MS)}` === key) {
            group.push(e);
            j++;
          } else {
            break;
          }
        }
        if (group.length > 1) {
          items.push({
            kind: "collapsed",
            group: { events: group, windowKey: key, source: event.event_source, firstTs: event.created_at },
          });
        } else {
          items.push({ kind: "single", event });
        }
        i = j;
      } else {
        items.push({ kind: "single", event });
        i++;
      }
    }
    return items;
  }, [events]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const dotColor = (source: string): string => SOURCE_DOT[source] ?? "bg-gray-400";
  const lineColor = (source: string): string => SOURCE_LINE[source] ?? "bg-gray-300";

  const FILTERS: { label: string; mode: FilterMode }[] = [
    { label: "All", mode: "all" },
    { label: "Agent", mode: "agent" },
    { label: "Plugin", mode: "plugin" },
    { label: "Synthesis", mode: "synthesis" },
    { label: "Trait", mode: "trait" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Pipeline Activity</h1>
          {scheduleState === "loading" && <p className="mt-1 text-sm text-[var(--color-text-muted)]" aria-busy="true">Loading synthesis schedule...</p>}
          {scheduleState === "error" && <p className="mt-1 text-sm text-[var(--color-error-text)]" role="alert">Synthesis schedule unavailable: {scheduleError}</p>}
          {scheduleState === "success" && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{nextRun}</p>}
        </div>
        <div className="text-sm text-[var(--color-text-muted)] space-x-4">
          {eventsState === "loading" && <span aria-busy="true">Loading events...</span>}
          {eventsState === "error" && <span>Events unavailable: {eventsError}</span>}
          {eventsState === "success" && (
            <>
              <span>Total: <strong>{stats.total}</strong></span>
              <span>Observations: <strong className="text-[var(--color-warning-text)]">{stats.observations}</strong></span>
              <span>Syntheses: <strong className="text-emerald-600">{stats.syntheses}</strong></span>
              <span>Traits: <strong className="text-[var(--color-text-link)]">{stats.traits}</strong></span>
              <span>Skills: <strong className="text-purple-600">{stats.skills}</strong></span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.mode}
            onClick={() => setFilterMode(f.mode)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filterMode === f.mode
                ? "bg-gray-800 text-white shadow-sm"
                : "bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setPaused((p) => !p)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            paused
              ? "bg-[var(--color-success-bg)] border-green-300 text-green-700 hover:bg-[var(--color-success-bg)]"
              : "bg-[var(--color-warning-bg)] border-amber-300 text-amber-700 hover:bg-[var(--color-surface-hover)]"
          }`}
        >
          {paused ? "\u25B6 Resume" : "\u275A\u275A Pause"}
        </button>
      </div>

      {eventsState === "loading" && (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-8 text-center text-[var(--color-text-muted)]" aria-busy="true">
          Loading pipeline events...
        </div>
      )}

      {eventsState === "error" && (
        <div className="rounded border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-8 text-center text-[var(--color-error-text)]" role="alert">
          Pipeline events are unavailable: {eventsError}
        </div>
      )}

      {eventsState === "success" && events.length === 0 && (
        <div className="bg-[var(--color-surface-muted)] p-8 rounded border border-[var(--color-border)] text-center text-[var(--color-text-muted)]">
          No pipeline events yet. Events are logged automatically during agent interactions.
        </div>
      )}

      {eventsState === "success" && events.length > 0 && (
        <div className="relative">
          <div className="absolute left-[36px] top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700" />

          <div className="space-y-0">
            {displayItems.map((item, idx) => {
              const isLast = idx === displayItems.length - 1;

              if (item.kind === "collapsed") {
                const group = item.group;
                const isExpanded = expandedGroups.has(group.windowKey);

                return (
                  <div key={group.windowKey} className="relative mb-0">
                    <EventRow
                      source={group.source}
                      icon="\u25CF"
                      iconLabel="+N"
                      countBadge={group.events.length}
                      isExpanded={isExpanded}
                      onToggle={() => toggleGroup(group.windowKey)}
                      title={`${group.events.length} observations`}
                      description={`${SOURCE_LABEL[group.source] ?? group.source} observed ${group.events.length} times`}
                      timestamp={group.firstTs}
                      sourceLabel={SOURCE_LABEL[group.source] ?? group.source}
                      dotColor={dotColor(group.source)}
                      lineColor={lineColor(group.source)}
                      isLast={isLast}
                      onClickDetail={() =>
                        setSelected({ kind: "batch", events: group.events, label: `${group.events.length} observations` })
                      }
                    >
                      {isExpanded && (
                        <div className="mt-2 border-l-2 border-dashed border-gray-300 dark:border-gray-600 ml-5 pl-4 space-y-2">
                          {group.events.map((obs) => (
                            <button
                              type="button"
                              key={obs.id}
                              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left hover:shadow-md transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
                              onClick={() => setSelected(obs)}
                              aria-label={`View event ${obs.id}`}
                            >
                              <span className="mb-1 flex flex-wrap items-center gap-2">
                                <span className={`${BADGE_BASE} border ${SOURCE_BADGE[obs.event_source] ?? badgeTones("muted")}`}>
                                  {SOURCE_LABEL[obs.event_source] ?? obs.event_source}
                                </span>
                                <span className="text-xs text-[var(--color-text-muted)]">{formatRelativeTime(obs.created_at)}</span>
                                {obs.importance != null && (
                                  <span className="text-xs text-[var(--color-text-muted)]">imp: {obs.importance}</span>
                                )}
                              </span>
                              <span className="block text-sm text-[var(--color-text-primary)]">{obs.title}</span>
                              {obs.description && <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">{obs.description}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </EventRow>

                    {isExpanded &&
                      group.events.map((obs) => {
                        const children = childMap.get(obs.id);
                        if (!children) return null;
                        return (
                          <div key={`ch-${obs.id}`} className="ml-10 pl-6 border-l-2 border-dashed border-gray-300 dark:border-gray-600 space-y-0">
                            {children.map((child) => (
                              <EventRow
                                key={child.id}
                                source={child.event_source}
                                icon={EVENT_ICON[child.event_type] ?? "\u25CB"}
                                title={child.title}
                                description={child.description}
                                timestamp={child.created_at}
                                sourceLabel={SOURCE_LABEL[child.event_source] ?? child.event_source}
                                dotColor={dotColor(child.event_source)}
                                lineColor={lineColor(child.event_source)}
                                isLast={false}
                                isChild
                                onClickDetail={() => setSelected(child)}
                              />
                            ))}
                          </div>
                        );
                      })}
                  </div>
                );
              }

              const evt = item.event;
              const children = childMap.get(evt.id);

              return (
                <div key={evt.id} className="relative mb-0">
                  <EventRow
                    source={evt.event_source}
                    icon={EVENT_ICON[evt.event_type] ?? "\u25CB"}
                    title={evt.title}
                    description={evt.description}
                    timestamp={evt.created_at}
                    sourceLabel={SOURCE_LABEL[evt.event_source] ?? evt.event_source}
                    dotColor={dotColor(evt.event_source)}
                    lineColor={lineColor(evt.event_source)}
                    sessionId={evt.session_id}
                    isLast={isLast && !children}
                    onClickDetail={() => setSelected(evt)}
                  />

                  {children && (
                    <div className="ml-10 pl-6 border-l-2 border-dashed border-gray-300 dark:border-gray-600 space-y-0">
                      {children.map((child) => (
                        <EventRow
                          key={child.id}
                          source={child.event_source}
                          icon={EVENT_ICON[child.event_type] ?? "\u25CB"}
                          title={child.title}
                          description={child.description}
                          timestamp={child.created_at}
                          sourceLabel={SOURCE_LABEL[child.event_source] ?? child.event_source}
                          dotColor={dotColor(child.event_source)}
                          lineColor={lineColor(child.event_source)}
                          isLast={false}
                          isChild
                          onClickDetail={() => setSelected(child)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Overlay
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        title={
          selected?.kind === "batch"
            ? selected.label
            : `Event #${selected?.id ?? ""}`
        }
        subtitle={
          selected?.kind === "batch"
            ? `${selected.events.length} observations`
            : selected?.event_type
              ? `${selected.event_type} \u00B7 ${selected.event_source}`
              : undefined
        }
      >
        {selected && selected.kind === "batch" && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-text-muted)]">
              Batch of {selected.events.length} observations from {selected.events[0]?.event_source ?? "unknown"}.
            </p>
            {selected.events.map((obs: PipelineEvent) => (
              <div key={obs.id} className="border border-[var(--color-border)] rounded p-3 bg-[var(--color-surface-muted)]">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={`${BADGE_BASE} border ${SOURCE_BADGE[obs.event_source] ?? badgeTones("muted")}`}>
                    {obs.event_source}
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)]">{fmtAbs(obs.created_at)}</span>
                </div>
                <p className="text-sm font-medium">{obs.title}</p>
                {obs.description && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{obs.description}</p>}
                <div className="grid grid-cols-2 gap-2 mt-2 text-xs text-[var(--color-text-muted)]">
                  <div>Importance: {obs.importance ?? 5}/10</div>
                  <div>Session: {obs.session_id?.slice(0, 8) ?? "\u2014"}</div>
                </div>
                {obs.data != null && (
                  <div className="mt-2">
                    <h3 className="text-xs font-semibold mb-1">Raw JSON Data</h3>
                    <pre className="bg-[var(--color-surface-muted)] p-3 rounded border border-[var(--color-border)] overflow-x-auto text-xs font-mono whitespace-pre-wrap">
                      {JSON.stringify(parseData(obs.data), null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {selected && selected.kind !== "batch" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-semibold">Type:</span>{" "}
                <span className="text-[var(--color-text-secondary)]">{selected.event_type}</span>
              </div>
              <div>
                <span className="font-semibold">Source:</span>{" "}
                <span
                  className={`${BADGE_BASE} border ${SOURCE_BADGE[selected.event_source] ?? badgeTones("muted")}`}
                >
                  {selected.event_source}
                </span>
              </div>
              <div>
                <span className="font-semibold">Importance:</span>{" "}
                <span className="text-[var(--color-text-secondary)]">{selected.importance ?? 5}/10</span>
              </div>
              <div>
                <span className="font-semibold">Session:</span>{" "}
                <span className="text-[var(--color-text-secondary)] font-mono text-xs">
                  {selected.event_source === "synthesis" && !selected.session_id
                    ? "Scheduled"
                    : selected.session_id?.slice(0, 12) ?? "\u2014"}
                </span>
              </div>
              <div className="col-span-2">
                <span className="font-semibold">Created:</span>{" "}
                <span className="text-[var(--color-text-secondary)]">{fmtAbs(selected.created_at)}</span>
              </div>
              {selected.parent_event_id != null && (
                <div className="col-span-2">
                  <span className="font-semibold">Parent Event ID:</span>{" "}
                  <span className="text-[var(--color-text-secondary)] font-mono">{selected.parent_event_id}</span>
                </div>
              )}
            </div>
            <div>
              <h3 className="font-semibold mb-1">Title</h3>
              <p className="text-sm text-[var(--color-text-primary)]">{selected.title}</p>
            </div>
            {selected.description && (
              <div>
                <h3 className="font-semibold mb-1">Description</h3>
                <p className="text-sm text-[var(--color-text-secondary)]">{selected.description}</p>
              </div>
            )}
            {selected.data != null && (
              <div>
                {selected.event_type === "synthesis_completed" && (
                  <div className="space-y-3">
                    {(() => {
                      const d = parseData(selected.data);
                      return (
                        <>
                          {d?.model && (
                            <div className="text-sm text-[var(--color-text-secondary)]">
                              <span className="font-semibold">Model:</span> {d.model}
                              {d?.endpoint && <span className="text-[var(--color-text-muted)]"> @ {d.endpoint}</span>}
                            </div>
                          )}
                          {d?.insights?.length > 0 && (
                            <div>
                              <h3 className="font-semibold text-sm mb-1">LLM Insights:</h3>
                              <ul className="text-sm text-[var(--color-text-secondary)] space-y-1 border-l-2 border-blue-200 pl-3">
                                {d.insights.map((i: string, idx: number) => (
                                  <li key={idx}>&bull; {i}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {d?.skills_created > 0 && (
                            <p className="text-sm text-[var(--color-text-secondary)]">
                              <span className="font-semibold">Skills created:</span> {d.skills_created}
                            </p>
                          )}
                          {d?.traits_created > 0 && (
                            <p className="text-sm text-[var(--color-text-secondary)]">
                              <span className="font-semibold">Traits created:</span> {d.traits_created}
                            </p>
                          )}
                          {d?.observation_ids?.length > 0 && (
                            <p className="text-sm">
                              <span className="font-semibold text-[var(--color-text-secondary)]">Referenced:</span>{" "}
                              <a
                                href={`/observations?project=${d.project_name || project}`}
                                className="text-[var(--color-text-link)] underline text-sm"
                              >
                                View Observations
                              </a>
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                {selected.event_type === "trait_created" && (() => {
                  const d = parseData(selected.data);
                  return d?.skill_name ? (
                    <div className="space-y-2">
                      <div className="text-sm text-[var(--color-text-secondary)]">
                        <span className="font-semibold">Skill:</span>{" "}
                        <a
                          href={`/skills?project=${d.project_name || project}`}
                          className="text-[var(--color-text-link)] underline font-medium"
                        >
                          {d.skill_name}
                        </a>
                        {d?.via_llm && <span className="text-xs text-[var(--color-text-muted)] ml-1">via LLM</span>}
                      </div>
                      {d?.model && <p className="text-xs text-[var(--color-text-muted)]">Model: {d.model}</p>}
                    </div>
                  ) : null;
                })()}

                {selected.event_type === "trait_created" && (() => {
                  const d = parseData(selected.data);
                  return d?.trait_type && !d?.skill_name ? (
                    <div className="space-y-2">
                      <div className="text-sm text-[var(--color-text-secondary)]">
                        <span className="font-semibold">Trait:</span>{" "}
                        <a
                          href={`/personality?project=${d.project_name || project}`}
                          className="text-[var(--color-text-link)] underline font-medium"
                        >
                          {d.trait_type} &rarr; {d.trait_value?.slice(0, 60)}
                        </a>
                        {d?.confidence != null && (
                          <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                            confidence: {(d.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                  ) : null;
                })()}

                {selected.event_type === "trait_updated" && (() => {
                  const d = parseData(selected.data);
                  return d?.trait_type ? (
                    <div className="space-y-2">
                      <div className="text-sm text-[var(--color-text-secondary)]">
                        <span className="font-semibold">Trait:</span>{" "}
                        <a
                          href={`/personality?project=${d.project_name || project}`}
                          className="text-[var(--color-text-link)] underline font-medium"
                        >
                          {d.trait_type} &rarr; {d.trait_value?.slice(0, 60)}
                        </a>
                        {d?.confidence != null && (
                          <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                            confidence: {(d.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                  ) : null;
                })()}

                {selected.event_type !== "synthesis_completed" &&
                  selected.event_type !== "trait_created" &&
                  selected.event_type !== "trait_updated" &&
                  (() => {
                    const d = parseData(selected.data);
                    return d != null && Object.keys(d).length > 0 ? (
                      <div>
                        <h3 className="font-semibold mb-1">Raw JSON Data</h3>
                        <pre className="bg-[var(--color-surface-muted)] p-4 rounded border border-[var(--color-border)] overflow-x-auto text-xs font-mono whitespace-pre-wrap">
                          {JSON.stringify(d, null, 2)}
                        </pre>
                      </div>
                    ) : null;
                  })()}
              </div>
            )}
          </div>
        )}
      </Overlay>
    </div>
  );
}

function EventRow({
  source,
  icon,
  iconLabel,
  countBadge,
  isExpanded,
  onToggle,
  title,
  description,
  timestamp,
  sourceLabel,
  dotColor,
  lineColor,
  sessionId,
  isLast = false,
  isChild = false,
  onClickDetail,
  children,
}: {
  source: string;
  icon: string;
  iconLabel?: string;
  countBadge?: number;
  isExpanded?: boolean;
  onToggle?: () => void;
  title: string;
  description?: string;
  timestamp: string;
  sourceLabel: string;
  dotColor: string;
  lineColor: string;
  sessionId?: string;
  isLast?: boolean;
  isChild?: boolean;
  onClickDetail?: () => void;
  children?: React.ReactNode;
}) {
  const dotClassName = `shrink-0 z-10 flex items-center justify-center rounded-full border-2 border-[var(--color-border)] ${
    isChild ? "w-2 h-2" : "w-3 h-3"
  } ${dotColor} ${countBadge ? "hover:ring-2 hover:ring-offset-1 hover:ring-offset-[var(--color-surface)] hover:ring-gray-300 dark:ring-gray-600 dark:hover:ring-offset-[var(--color-surface)]" : ""}`;
  const dotContent = countBadge ? (
    <span className="text-[8px] font-bold leading-none text-white">+{countBadge}</span>
  ) : (
    <span className={`${isChild ? "text-[6px]" : "text-[10px]"} select-none leading-none text-white`}>{icon}</span>
  );

  return (
    <div>
      <div className="flex">
        <div className="w-[72px] shrink-0 flex flex-col items-center relative">
          <div className={`w-0.5 flex-1 ${lineColor}`} />
          {onToggle ? (
            <button
              type="button"
              className={dotClassName}
              onClick={onToggle}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? `Collapse ${title}` : `Expand ${title}`}
              title={iconLabel}
            >
              {dotContent}
            </button>
          ) : (
            <span className={dotClassName} title={iconLabel} aria-hidden="true">
              {dotContent}
            </span>
          )}
          <div className={`w-0.5 flex-1 ${isLast ? "bg-transparent" : lineColor}`} />
        </div>

        <div className={`min-w-0 flex-1 pb-3 ${isChild ? "pb-2" : ""}`}>
          <div
            className={`bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-3 ${
              isChild ? "p-2" : "p-3"
            } ${onClickDetail ? "hover:shadow-md transition-shadow" : ""}`}
          >
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span
                className={`${BADGE_BASE} border ${SOURCE_BADGE[source] ?? badgeTones("muted")}`}
              >
                {sourceLabel}
              </span>
              {isExpanded !== undefined && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
                  className="text-xs text-[var(--color-text-link)] hover:text-blue-800 font-medium"
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? "Collapse" : `+${countBadge ?? 0} observations`}
                </button>
              )}
              <span className="text-xs text-[var(--color-text-muted)] flex-1 text-right" title={fmtAbs(timestamp)}>
                {formatRelativeTime(timestamp)}
              </span>
              {sessionId && !countBadge && (
                <span className="text-xs text-[var(--color-text-muted)] font-mono">
                  {sessionId.slice(0, 8)}
                </span>
              )}
            </div>
            {onClickDetail ? (
              <button
                type="button"
                onClick={onClickDetail}
                className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
                aria-label={`View event ${title}`}
              >
                <span className={`block font-semibold text-[var(--color-text-primary)] ${isChild ? "text-xs" : "text-sm"}`}>
                  {title}
                </span>
                {description && (
                  <span className={`block text-[var(--color-text-muted)] ${isChild ? "text-xs" : "text-sm"}`}>
                    {description}
                  </span>
                )}
              </button>
            ) : (
              <>
                <p className={`font-semibold text-[var(--color-text-primary)] ${isChild ? "text-xs" : "text-sm"}`}>{title}</p>
                {description && <p className={`text-[var(--color-text-muted)] ${isChild ? "text-xs" : "text-sm"}`}>{description}</p>}
              </>
            )}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
