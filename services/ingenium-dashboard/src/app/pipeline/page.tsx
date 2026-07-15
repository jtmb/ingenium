"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api, type PipelineEvent } from "../../lib/api";
import Overlay from "../components/Overlay";
import { badgeTones, BADGE_BASE } from "@/lib/badgeTones";

// ── Color maps ───────────────────────────────────────────────────────────
const SOURCE_DOT: Record<string, string> = {
  agent: "bg-amber-500",
  plugin: "bg-blue-500",
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

// ── Helpers ──────────────────────────────────────────────────────────────
const WINDOW_MS = 60_000;

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.abs(Math.floor(diff / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

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

// ── Display item types ───────────────────────────────────────────────────
interface CollapsedGroup {
  events: PipelineEvent[];
  windowKey: string;
  source: string;
  firstTs: string;
}

type DisplayItem =
  | { kind: "single"; event: PipelineEvent }
  | { kind: "collapsed"; group: CollapsedGroup };

// ── Filter mode ──────────────────────────────────────────────────────────
type FilterMode = "all" | "agent" | "plugin" | "synthesis" | "trait";

// ── Page ─────────────────────────────────────────────────────────────────
export default function PipelinePage() {
  const project = useProject();
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [selected, setSelected] = useState<any>(null);
  const [paused, setPaused] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [nextRun, setNextRun] = useState("");
  const [intervalMs, setIntervalMs] = useState(900000);

  // Fetch synthesis interval for countdown
  useEffect(() => {
    api.settings.get("synthesis_interval_ms", "global-default").then((r) => {
      const ms = parseInt(r.data?.value, 10);
      if (!isNaN(ms) && ms > 0) setIntervalMs(ms);
    }).catch(() => {});
  }, []);

  // Countdown to next synthesis run
  useEffect(() => {
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
  }, [events, intervalMs]);

  // ── Fetch ────────────────────────────────────────────────────────────
  const fetchEvents = useCallback(() => {
    const sourceParam =
      filterMode === "agent" || filterMode === "plugin" || filterMode === "synthesis"
        ? filterMode
        : undefined;

    api.pipeline
      .events(project, { limit: 500, ...(sourceParam ? { source: sourceParam } : {}) })
      .then((r: any) => {
        let data: PipelineEvent[] = (r.data || []);
        if (filterMode === "trait") {
          data = data.filter(
            (e) => e.event_type === "trait_created" || e.event_type === "trait_updated",
          );
        }
        setEvents(data);
      })
      .catch(() => {});
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
    } else {
      intervalRef.current = setInterval(fetchEvents, 3_000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [paused, fetchEvents]);

  // ── Derived state ────────────────────────────────────────────────────
  const stats = useMemo(
    () => ({
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
    }),
    [events],
  );

  // Build parent → children map for nested rendering
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

  // Collapse observation_created events in 60‑second windows
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

  // ── Helpers ──────────────────────────────────────────────────────────
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

  // ── Filter pills ─────────────────────────────────────────────────────
  const FILTERS: { label: string; mode: FilterMode }[] = [
    { label: "All", mode: "all" },
    { label: "Agent", mode: "agent" },
    { label: "Plugin", mode: "plugin" },
    { label: "Synthesis", mode: "synthesis" },
    { label: "Trait", mode: "trait" },
  ];

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ── Header + stats ──────────────────────────────────────────── */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Pipeline Activity</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">{nextRun}</p>
        </div>
        <div className="text-sm text-[var(--color-text-muted)] space-x-4">
          <span>
            Total: <strong>{stats.total}</strong>
          </span>
          <span>
            Observations:{" "}
            <strong className="text-[var(--color-warning-text)]">{stats.observations}</strong>
          </span>
          <span>
            Syntheses:{" "}
            <strong className="text-emerald-600">{stats.syntheses}</strong>
          </span>
          <span>
            Traits:{" "}
            <strong className="text-[var(--color-text-link)]">{stats.traits}</strong>
          </span>
          <span>
            Skills:{" "}
            <strong className="text-purple-600">{stats.skills}</strong>
          </span>
        </div>
      </div>

      {/* ── Filter pills + pause ────────────────────────────────────── */}
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

      {/* ── Timeline ─────────────────────────────────────────────────── */}
      {events.length === 0 && (
        <div className="bg-[var(--color-surface-muted)] p-8 rounded border border-[var(--color-border)] text-center text-[var(--color-text-muted)]">
          No pipeline events yet. Events are logged automatically during agent interactions.
        </div>
      )}

      {events.length > 0 && (
        <div className="relative">
          {/* Continuous vertical timeline line */}
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
                      {/* Expanded sub-list */}
                      {isExpanded && (
                        <div className="mt-2 border-l-2 border-dashed border-gray-300 dark:border-gray-600 ml-5 pl-4 space-y-2">
                          {group.events.map((obs) => (
                            <div
                              key={obs.id}
                              className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-3 cursor-pointer hover:shadow-md transition-shadow"
                              onClick={() => setSelected(obs)}
                            >
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className={`${BADGE_BASE} border ${SOURCE_BADGE[obs.event_source] ?? badgeTones("muted")}`}>
                                  {SOURCE_LABEL[obs.event_source] ?? obs.event_source}
                                </span>
                                <span className="text-xs text-[var(--color-text-muted)]">{formatRelative(obs.created_at)}</span>
                                {obs.importance != null && (
                                  <span className="text-xs text-[var(--color-text-muted)]">imp: {obs.importance}</span>
                                )}
                              </div>
                              <p className="text-sm text-[var(--color-text-primary)]">{obs.title}</p>
                              {obs.description && (
                                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{obs.description}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </EventRow>

                    {/* Render children of each observation in the group when expanded */}
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

              // ── Single event ─────────────────────────────────────
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

                  {/* Children (e.g. trait_created under synthesis_completed) */}
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

      {/* ── Detail Overlay ──────────────────────────────────────────── */}
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
                {/* synthesis_completed — rich structured view */}
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

                {/* trait_created with skill_name */}
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

                {/* trait_created with trait_type (not skill) */}
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

                {/* trait_updated — same structured view as trait_created */}
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

                {/* Fallback — raw JSON for unknown or empty data shapes */}
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

// ── EventRow sub‑component ──────────────────────────────────────────────
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
  return (
    <div>
      <div className="flex">
        {/* ── Timeline gutter ────────────────────────────────────── */}
        <div className="w-[72px] shrink-0 flex flex-col items-center relative">
          {/* Upper connector line segment */}
          <div className={`w-0.5 flex-1 ${lineColor}`} />
          {/* Dot / icon */}
          <div
            className={`shrink-0 z-10 flex items-center justify-center rounded-full border-2 border-white ${
              isChild ? "w-2 h-2" : "w-3 h-3"
            } ${dotColor} ${countBadge ? "cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-gray-300" : ""}`}
            onClick={onToggle}
            title={iconLabel}
          >
            {countBadge ? (
              <span className="text-[8px] font-bold text-white leading-none">
                +{countBadge}
              </span>
            ) : (
              <span className={`${isChild ? "text-[6px]" : "text-[10px]"} text-white leading-none select-none`}>
                {icon}
              </span>
            )}
          </div>
          {/* Lower connector line segment */}
          <div className={`w-0.5 flex-1 ${isLast ? "bg-transparent" : lineColor}`} />
        </div>

        {/* ── Event card ─────────────────────────────────────────── */}
        <div
          className={`flex-1 pb-3 ${isChild ? "pb-2" : ""} min-w-0`}
        >
          <div
            className={`bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-3 ${
              isChild ? "p-2" : "p-3"
            } ${onClickDetail ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}
            onClick={onClickDetail}
          >
            {/* Badge row */}
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span
                className={`${BADGE_BASE} border ${SOURCE_BADGE[source] ?? badgeTones("muted")}`}
              >
                {sourceLabel}
              </span>
              {isExpanded !== undefined && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
                  className="text-xs text-[var(--color-text-link)] hover:text-blue-800 font-medium"
                >
                  {isExpanded ? "Collapse" : `+${countBadge ?? 0} observations`}
                </button>
              )}
              <span className="text-xs text-[var(--color-text-muted)] flex-1 text-right" title={fmtAbs(timestamp)}>
                {formatRelative(timestamp)}
              </span>
              {sessionId && !countBadge && (
                <span className="text-xs text-[var(--color-text-muted)] font-mono">
                  {sessionId.slice(0, 8)}
                </span>
              )}
            </div>
            {/* Title + description */}
            <p className={`font-semibold text-[var(--color-text-primary)] ${isChild ? "text-xs" : "text-sm"}`}>
              {title}
            </p>
            {description && (
              <p className={`text-[var(--color-text-muted)] ${isChild ? "text-xs" : "text-sm"}`}>
                {description}
              </p>
            )}
          </div>
        </div>
      </div>
      {/* Render children of this row (e.g. expanded observations) */}
      {children}
    </div>
  );
}
