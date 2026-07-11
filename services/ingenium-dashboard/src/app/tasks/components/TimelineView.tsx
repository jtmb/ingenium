"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { api, Task } from "../../../lib/api";
import TaskDetail from "./TaskDetail";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const COLUMN_COLORS: Record<string, string> = {
  todo: "#9ca3af",
  in_progress: "#3b82f6",
  review: "#f59e0b",
  done: "#22c55e",
};

function daysBetween(d1: Date, d2: Date): number {
  const utc1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const utc2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
  return Math.floor((utc2 - utc1) / 86_400_000);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function parseDate(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/* ------------------------------------------------------------------ */
/*  Timeline View                                                     */
/* ------------------------------------------------------------------ */

type TimelineViewProps = {
  project: string;
  tasks: Task[];
  onTasksChange: (tasks: Task[]) => void;
};

export default function TimelineView({ project, tasks, onTasksChange }: TimelineViewProps) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Compute date range
  const { startDate, endDate, totalDays, dateLabels } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let latest = new Date(today);
    for (const t of tasks) {
      const dd = parseDate(t.due_date);
      if (dd && dd > latest) latest = dd;
    }
    // extend end by 7 days
    const end = new Date(latest);
    end.setDate(end.getDate() + 7);
    end.setHours(0, 0, 0, 0);

    const total = daysBetween(today, end) + 1;
    const labels: { date: Date; label: string }[] = [];
    for (let i = 0; i < total; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      labels.push({ date: new Date(d), label: formatDate(d) });
    }

    return { startDate: today, endDate: end, totalDays: total, dateLabels: labels };
  }, [tasks]);

  // Group tasks: epics → stories → subtasks
  const { epics, uncategorized } = useMemo(() => {
    const epicMap: Record<string, { epic: Task; stories: Task[] }> = {};
    const others: Task[] = [];

    for (const t of tasks) {
      if (t.issue_type === "epic") {
        const existing = epicMap[t.id];
        if (!existing) epicMap[t.id] = { epic: t, stories: [] };
        else existing.epic = t;
      } else if (t.epic_id && t.issue_type === "story") {
        const existing = epicMap[t.epic_id];
        if (!existing) {
          epicMap[t.epic_id] = { epic: { id: t.epic_id, title: "Unknown Epic", column_id: "todo", created_at: "" } as Task, stories: [t] };
        } else {
          existing.stories.push(t);
        }
      } else {
        others.push(t);
      }
    }

    // Build ordered list: each epic with its stories, then uncategorized
    const result: { epic: Task; stories: Task[] }[] = Object.values(epicMap);
    return { epics: result, uncategorized: others };
  }, [tasks]);

  // Build rows
  const rows = useMemo(() => {
    const r: { indent: number; task: Task; type: "epic" | "story" | "other" }[] = [];
    for (const { epic, stories } of epics) {
      r.push({ indent: 0, task: epic, type: "epic" });
      for (const s of stories) {
        r.push({ indent: 1, task: s, type: "story" });
      }
    }
    for (const t of uncategorized) {
      r.push({ indent: 0, task: t, type: "other" });
    }
    return r;
  }, [epics, uncategorized]);

  const handleTaskUpdated = (updated: Task) => {
    onTasksChange(tasks.map((t) => (t.id === updated.id ? updated : t)));
  };

  // Calculate bar position for a task
  function getBarPosition(task: Task): { colStart: number; colSpan: number; hasDates: boolean } | null {
    const sd = parseDate(task.start_date);
    const dd = parseDate(task.due_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!sd && !dd) {
      // No dates: single cell on today
      return { colStart: 1, colSpan: 1, hasDates: false };
    }

    const start = sd || today;
    const due = dd || new Date(today.getTime() + 86_400_000);
    if (due < startDate) return null; // entirely before range
    if (start > endDate) return null; // entirely after range

    const effectiveStart = start < startDate ? startDate : start;
    const effectiveEnd = due > endDate ? endDate : due;

    const colStart = daysBetween(startDate, effectiveStart) + 1;
    const colSpan = Math.max(1, daysBetween(effectiveStart, effectiveEnd) + 1);

    return { colStart, colSpan, hasDates: !!(sd || dd) };
  }

  return (
    <div className="space-y-1">
      {/* Legend */}
      <div className="flex gap-3 text-xs text-gray-500 mb-2 flex-wrap">
        {Object.entries(COLUMN_COLORS).map(([status, color]) => (
          <span key={status} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded inline-block" style={{ backgroundColor: color }} />
            {status.replace("_", " ")}
          </span>
        ))}
      </div>

      {/* Scrollable timeline */}
      <div
        ref={scrollRef}
        className="overflow-x-auto border border-gray-200 rounded bg-white"
      >
        <div style={{ minWidth: Math.max(totalDays * 40, 600) }}>
          {/* Header row: date labels */}
          <div
            className="grid border-b border-gray-200 bg-gray-50 sticky top-0 z-10"
            style={{ gridTemplateColumns: `180px repeat(${totalDays}, 40px)` }}
          >
            <div className="px-3 py-2 text-xs font-semibold text-gray-500 border-r border-gray-200">
              Task
            </div>
            {dateLabels.map((dl, i) => (
              <div
                key={i}
                className="px-0.5 py-2 text-[10px] text-gray-400 text-center border-r border-gray-100 leading-tight"
                title={dl.date.toDateString()}
              >
                {dl.date.getDate() === 1
                  ? formatDate(dl.date)
                  : dl.date.getDay() === 0
                    ? dl.date.getDate()
                    : ""}
              </div>
            ))}
          </div>

          {/* Body rows */}
          {rows.map((row, ri) => {
            const barPos = getBarPosition(row.task);
            const isEpic = row.type === "epic";

            return (
              <div
                key={row.task.id}
                className="grid border-b border-gray-100 hover:bg-gray-50 transition-colors"
                style={{ gridTemplateColumns: `180px repeat(${totalDays}, 40px)` }}
              >
                {/* Task label */}
                <div
                  className={`px-3 py-2 text-sm border-r border-gray-200 truncate flex items-center gap-1 ${
                    row.indent > 0 ? "pl-6" : ""
                  } ${isEpic ? "font-semibold text-gray-900" : "text-gray-700"}`}
                  title={row.task.title}
                >
                  {row.indent > 0 && <span className="text-gray-300 text-xs">└</span>}
                  {isEpic && (
                    <span className="text-xs text-gray-400 font-normal">⚡</span>
                  )}
                  <span className="truncate">{row.task.title}</span>
                </div>

                {/* Bar area: absolute-positioned bar inside grid cells */}
                {barPos ? (
                  <div
                    className="relative flex items-center cursor-pointer"
                    style={{ gridColumn: `${barPos.colStart} / span ${barPos.colSpan}` }}
                    onClick={() => setSelectedTask(row.task)}
                  >
                    <div
                      className="h-6 rounded flex items-center px-1.5 text-xs text-white font-medium truncate transition-opacity hover:opacity-80"
                      style={{
                        backgroundColor: COLUMN_COLORS[row.task.column_id] || "#9ca3af",
                        width: "100%",
                      }}
                    >
                      {!barPos.hasDates && (
                        <span className="text-[10px] opacity-75 mr-1">No dates</span>
                      )}
                      {row.task.title}
                    </div>
                  </div>
                ) : (
                  /* Empty cells for tasks outside range */
                  Array.from({ length: totalDays }).map((_, i) => (
                    <div key={i} className="border-r border-gray-50" />
                  ))
                )}
              </div>
            );
          })}

          {rows.length === 0 && (
            <div className="py-8 text-center text-gray-400 text-sm">
              No tasks to display. Create tasks to see the timeline.
            </div>
          )}
        </div>
      </div>

      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          project={project}
          onClose={() => setSelectedTask(null)}
          onTaskUpdated={handleTaskUpdated}
        />
      )}
    </div>
  );
}
