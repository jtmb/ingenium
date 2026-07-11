"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api, type LogEntry } from "../../lib/api";

// ── Constants ────────────────────────────────────────────────────────────
const MAX_ENTRIES = 500;
const POLL_MS = 2_000;

const ALL_LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof ALL_LEVELS)[number];

// ── Color maps ───────────────────────────────────────────────────────────
const SOURCE_BADGE: Record<string, string> = {
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

const LEVEL_DOT: Record<string, string> = {
  debug: "bg-gray-400",
  info: "bg-blue-500",
  warn: "bg-amber-500",
  error: "bg-red-500",
};

const LEVEL_BADGE: Record<string, string> = {
  debug: "bg-gray-100 text-gray-600 border-gray-300",
  info: "bg-blue-50 text-blue-700 border-blue-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  error: "bg-red-50 text-red-700 border-red-200",
};

const SOURCE_LABEL: Record<string, string> = {
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
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

function fmtFull(iso: string): string {
  return new Date(iso).toLocaleString();
}

function dedupeKey(e: LogEntry): string {
  return `${e.timestamp}|${e.source}|${e.level}|${e.message}`;
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function LogsPage() {
  const project = useProject();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set(["all"]));
  const [selectedLevels, setSelectedLevels] = useState<Set<Level>>(new Set(["info", "warn", "error"]));
  const [searchText, setSearchText] = useState("");

  // UI state
  const [paused, setPaused] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const seenKeys = useRef(new Set<string>());
  const lastTimestampRef = useRef<string>("");

  // ── Fetch ──────────────────────────────────────────────────────────────
  const fetchLogs = useCallback(() => {
    api.logs
      .list(project, lastTimestampRef.current || undefined, 200)
      .then((r: any) => {
        const data = r.data || r;
        const newEntries: LogEntry[] = data.entries || [];
        const newSources: string[] = data.sources || [];

        if (newEntries.length > 0) {
          // Deduplicate using seenKeys
          const unseen = newEntries.filter((e) => {
            const key = dedupeKey(e);
            if (seenKeys.current.has(key)) return false;
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
            const latest = unseen[unseen.length - 1]!;
            lastTimestampRef.current = latest.timestamp;
          }
        }

        setSources(newSources);
        setTotal(data.total ?? 0);
        setLastUpdate(new Date().toISOString());
        setError(null);
        setLoading(false);
      })
      .catch((err: Error) => {
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
    } else {
      intervalRef.current = setInterval(fetchLogs, POLL_MS);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [paused, fetchLogs]);

  // ── Auto-scroll ────────────────────────────────────────────────────────
  useEffect(() => {
    if (shouldAutoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // If within 4px of bottom, resume auto-scroll; otherwise pause it
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 4;
  }, []);

  // ── Filter logic ───────────────────────────────────────────────────────
  const filteredEntries = useMemo(() => {
    const showAllSources = selectedSources.has("all");
    return entries.filter((e) => {
      if (!showAllSources && !selectedSources.has(e.source)) return false;
      if (!selectedLevels.has(e.level as Level)) return false;
      if (
        searchText &&
        !e.message.toLowerCase().includes(searchText.toLowerCase())
      )
        return false;
      return true;
    });
  }, [entries, selectedSources, selectedLevels, searchText]);

  // Derived stats
  const activeSourcesCount = useMemo(
    () => new Set(entries.map((e) => e.source)).size,
    [entries],
  );

  // ── Toggle helpers ─────────────────────────────────────────────────────
  const toggleSource = (src: string) => {
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
        if (next.size === 0) next.add("all");
      } else {
        next.add(src);
      }
      return next;
    });
  };

  const toggleLevel = (lvl: Level) => {
    setSelectedLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) {
        next.delete(lvl);
      } else {
        next.add(lvl);
      }
      return next;
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* ── Status Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">System Logs</h1>
          <p className="text-sm text-gray-400 mt-1">
            Live log stream from the Ingenium server
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>
            Total: <strong>{total}</strong>
          </span>
          <span>
            Sources:{" "}
            <strong className="text-blue-600">{activeSourcesCount}</strong>
          </span>
          <span>
            Displayed:{" "}
            <strong className="text-emerald-600">
              {filteredEntries.length}
            </strong>
          </span>
          <span className="text-gray-400">
            {lastUpdate ? `Updated ${fmtTime(lastUpdate)}` : "—"}
          </span>
          <button
            onClick={() => setPaused((p) => !p)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              paused
                ? "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
                : "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
            }`}
          >
            {paused ? "▶ Resume" : "⏸ Paused"} —{" "}
            {paused ? "PAUSED" : "LIVE"}
          </button>
        </div>
      </div>

      {/* ── Filter Bar ──────────────────────────────────────────────────── */}
      <div className="bg-white border rounded p-3 hover:shadow-md transition-shadow space-y-3">
        {/* Source pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-400 mr-1 font-medium">
            Sources:
          </span>
          {/* All pill */}
          <button
            onClick={() => toggleSource("all")}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              selectedSources.has("all")
                ? "bg-gray-800 text-white shadow-sm"
                : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-100"
            }`}
          >
            All
          </button>
          {sources.map((src) => {
            const badge = SOURCE_BADGE[src] ?? "bg-gray-50 text-gray-600 border-gray-200";
            const isSelected = selectedSources.has(src);
            return (
              <button
                key={src}
                onClick={() => toggleSource(src)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  isSelected
                    ? `${badge} shadow-sm ring-1 ring-offset-1`
                    : "bg-white border-gray-200 text-gray-500 hover:bg-gray-100"
                }`}
              >
                {SOURCE_LABEL[src] ?? src}
              </button>
            );
          })}
        </div>

        {/* Level checkboxes + search */}
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-xs text-gray-400 font-medium">Levels:</span>
          {ALL_LEVELS.map((lvl) => {
            const isSelected = selectedLevels.has(lvl);
            const dot = LEVEL_DOT[lvl] ?? "bg-gray-400";
            return (
              <label
                key={lvl}
                className={`flex items-center gap-1.5 text-xs cursor-pointer select-none ${
                  isSelected ? "text-gray-800 font-medium" : "text-gray-400"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleLevel(lvl)}
                  className="sr-only"
                />
                <span
                  className={`w-2.5 h-2.5 rounded-full inline-block ${dot} ${
                    isSelected ? "ring-2 ring-offset-1 ring-gray-300" : "opacity-40"
                  }`}
                />
                {lvl.toUpperCase()}
              </label>
            );
          })}
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search messages..."
              className="w-full border border-gray-200 rounded text-xs px-3 py-1.5 focus:outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-200"
            />
          </div>
        </div>
      </div>

      {/* ── Log Table ────────────────────────────────────────────────────── */}
      {loading && entries.length === 0 && (
        <div className="bg-gray-50 border rounded p-12 text-center text-gray-400">
          Loading logs...
        </div>
      )}

      {error && entries.length === 0 && (
        <div className="bg-red-50 border border-red-200 rounded p-6 text-center text-red-600 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && filteredEntries.length === 0 && (
        <div className="bg-gray-50 border rounded p-12 text-center text-gray-400">
          <p className="text-lg font-medium mb-1">No log entries yet.</p>
          <p className="text-sm">System is running. Logs will appear here as events occur.</p>
        </div>
      )}

      {filteredEntries.length > 0 && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="bg-white border rounded overflow-y-auto max-h-[calc(100vh-24rem)] hover:shadow-md transition-shadow"
        >
          <table className="w-full text-sm font-mono">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-2 whitespace-nowrap w-[80px]">Time</th>
                <th className="px-4 py-2 whitespace-nowrap w-[110px]">Source</th>
                <th className="px-4 py-2 whitespace-nowrap w-[60px]">Level</th>
                <th className="px-4 py-2">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredEntries.map((entry, idx) => {
                const sourceBadge =
                  SOURCE_BADGE[entry.source] ??
                  "bg-gray-50 text-gray-600 border-gray-200";
                const levelDot = LEVEL_DOT[entry.level] ?? "bg-gray-400";
                const levelBadge =
                  LEVEL_BADGE[entry.level] ??
                  "bg-gray-100 text-gray-600 border-gray-300";
                return (
                  <tr
                    key={`${entry.timestamp}-${idx}`}
                    className="hover:bg-gray-50 transition-colors"
                    title={fmtFull(entry.timestamp)}
                  >
                    <td className="px-4 py-1.5 text-xs text-gray-400 whitespace-nowrap">
                      {fmtTime(entry.timestamp)}
                    </td>
                    <td className="px-4 py-1.5 whitespace-nowrap">
                      <span
                        className={`text-xs px-2 py-0.5 rounded border ${sourceBadge}`}
                      >
                        {SOURCE_LABEL[entry.source] ?? entry.source}
                      </span>
                    </td>
                    <td className="px-4 py-1.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border ${levelBadge}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${levelDot}`}
                        />
                        {entry.level.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-1.5 text-xs text-gray-700 break-all">
                      {entry.message}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
