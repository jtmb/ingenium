"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  closestCorners,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, Task, BoardColumn, BoardConfig } from "../../../lib/api";
import TaskDetail from "./TaskDetail";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_COLUMNS: BoardColumn[] = [
  { id: "todo", name: "To Do", wip_limit: undefined, order: 0 },
  { id: "in_progress", name: "In Progress", wip_limit: undefined, order: 1 },
  { id: "review", name: "Review", wip_limit: undefined, order: 2 },
  { id: "done", name: "Done", wip_limit: undefined, order: 3 },
];

const PRIORITY_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-amber-400 text-amber-900",
  low: "bg-green-500 text-white",
};

const COLUMN_COLORS: Record<string, string> = {
  todo: "bg-gray-100 text-gray-600",
  in_progress: "bg-blue-100 text-blue-700",
  review: "bg-amber-100 text-amber-700",
  done: "bg-green-100 text-green-700",
};

function priorityWeight(t: Task): number {
  return PRIORITY_WEIGHT[t.priority ?? ""] ?? 0;
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const pw = priorityWeight(b) - priorityWeight(a);
    if (pw !== 0) return pw;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

function isOverdue(dateStr?: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return d < today;
}

function initials(name?: string): string {
  if (!name || !name.trim()) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w[0] ?? "").toUpperCase())
    .slice(0, 2)
    .join("");
}

function daysBetween(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  return Math.max(0, Math.ceil((e.getTime() - s.getTime()) / 86_400_000));
}

function dayInYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000);
}

function hexColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 60%)`;
}

/* ------------------------------------------------------------------ */
/*  Time Remaining Mini SVG Pie                                       */
/* ------------------------------------------------------------------ */

function TimePie({ estimated, spent }: { estimated: number; spent: number }) {
  const pct = estimated > 0 ? Math.min(spent / estimated, 1) : 0;
  const r = 18;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  const fill = pct >= 1 ? "#ef4444" : pct > 0.75 ? "#f59e0b" : "#22c55e";
  return (
    <svg width="18" height="18" viewBox="0 0 40 40" className="inline-block align-middle">
      <circle cx="20" cy="20" r={r} fill="none" stroke="#e5e7eb" strokeWidth="4" />
      <circle
        cx="20" cy="20" r={r} fill="none" stroke={fill} strokeWidth="4"
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" transform="rotate(-90 20 20)"
      />
      <text x="20" y="24" textAnchor="middle" fontSize="10" fill="#4b5563" fontFamily="sans-serif">
        {Math.round(pct * 100)}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Sortable Card                                                     */
/* ------------------------------------------------------------------ */

function SortableCard({
  task,
  compact,
  onClick,
}: {
  task: Task;
  compact: boolean;
  onClick: (t: Task) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { type: "card", task, columnId: task.column_id } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const overdue = isOverdue(task.due_date);

  const baseCard =
    "bg-white border rounded hover:shadow-md transition-shadow cursor-pointer";

  if (compact) {
    return (
      <div ref={setNodeRef} style={style} {...attributes} {...listeners}
        className={`${baseCard} p-1.5 text-xs`}
        onClick={() => onClick(task)}
      >
        <div className="font-medium truncate">{task.title}</div>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`${baseCard} p-3 text-sm space-y-1.5`}
      onClick={() => onClick(task)}
    >
      <div className="font-semibold text-gray-900 truncate">{task.title}</div>
      <div className="flex items-center gap-2 flex-wrap">
        {task.priority && (
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLORS[task.priority] || "bg-gray-200 text-gray-600"}`}>
            {task.priority}
          </span>
        )}
        {task.issue_type && (
          <span className="text-xs text-gray-500">{task.issue_type}</span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
        {task.assigned_to && (
          <span
            className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white shrink-0"
            style={{ backgroundColor: hexColor(task.assigned_to) }}
            title={task.assigned_to}
          >
            {initials(task.assigned_to)}
          </span>
        )}
        {task.due_date && (
          <span className={`${overdue ? "text-red-600 font-semibold" : ""}`}>
            {new Date(task.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        )}
        {task.estimated_hours != null && <TimePie estimated={task.estimated_hours} spent={task.spent_hours ?? 0} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Column Droppable                                                  */
/* ------------------------------------------------------------------ */

function ColumnDroppable({
  column,
  tasks,
  compact,
  wipLimit,
  onTaskClick,
}: {
  column: BoardColumn;
  tasks: Task[];
  compact: boolean;
  wipLimit?: number;
  onTaskClick: (t: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col-${column.id}`,
    data: { type: "column", columnId: column.id },
  });

  const threshold = wipLimit != null && tasks.length >= wipLimit;

  return (
    <div
      ref={setNodeRef}
      className={`bg-gray-100 rounded min-h-[160px] flex flex-col transition-colors ${isOver ? "bg-blue-50 ring-2 ring-blue-300" : ""}`}
    >
      {/* Column header */}
      <div
        className={`px-3 py-2 border-b border-gray-200 font-medium text-sm uppercase flex items-center justify-between ${
          threshold ? "bg-red-100 text-red-800" : "text-gray-600"
        }`}
      >
        <span className="truncate">{column.name}</span>
        <span className="text-xs font-normal ml-1 shrink-0">
          {wipLimit != null ? `${tasks.length}/${wipLimit}` : tasks.length}
          {threshold && (
            <svg className="w-3 h-3 inline ml-0.5 align-[-1px]" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          )}
        </span>
      </div>

      {/* Cards */}
      <div className="p-2 space-y-1.5 flex-1">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => (
            <SortableCard key={t.id} task={t} compact={compact} onClick={onTaskClick} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <p className="text-xs text-gray-400 italic p-2">No tasks</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Drag Overlay Card (static clone while dragging)                    */
/* ------------------------------------------------------------------ */

function DragCard({ task }: { task: Task }) {
  return (
    <div className="bg-white border rounded p-3 text-sm shadow-lg w-56">
      <div className="font-semibold text-gray-900 truncate">{task.title}</div>
      {task.priority && (
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLORS[task.priority] || "bg-gray-200 text-gray-600"}`}>
          {task.priority}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Swimlane grouping helpers                                          */
/* ------------------------------------------------------------------ */

type SwimlaneMode = "none" | "assignee" | "epic" | "priority";

const SWIMLANE_LABELS: Record<SwimlaneMode, string> = {
  none: "No grouping",
  assignee: "By Assignee",
  epic: "By Epic",
  priority: "By Priority",
};

function groupTasks(tasks: Task[], swimlane: SwimlaneMode): Record<string, Task[]> {
  if (swimlane === "none") return { "": tasks };
  const groups: Record<string, Task[]> = {};
  for (const t of tasks) {
    let key: string;
    switch (swimlane) {
      case "assignee":
        key = t.assigned_to || "Unassigned";
        break;
      case "epic":
        key = t.epic_id || "No Epic";
        break;
      case "priority":
        key = t.priority || "No Priority";
        break;
      default:
        key = "";
    }
    if (!groups[key]) groups[key] = [];
    (groups[key] as Task[]).push(t);
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/*  Board View                                                        */
/* ------------------------------------------------------------------ */

type BoardViewProps = {
  project: string;
  tasks: Task[];
  onTasksChange: (tasks: Task[]) => void;
};

export default function BoardView({ project, tasks, onTasksChange }: BoardViewProps) {
  const [columns, setColumns] = useState<BoardColumn[]>(DEFAULT_COLUMNS);
  const [swimlane, setSwimlane] = useState<SwimlaneMode>("none");
  const [compact, setCompact] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("tasks_density") === "compact";
    }
    return false;
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [error, setError] = useState("");

  // Fetch board config from API
  useEffect(() => {
    api.tasks
      .boardConfig(project)
      .then((r) => {
        if (r.data?.columns?.length) {
          setColumns(r.data.columns.sort((a, b) => a.order - b.order));
        }
      })
      .catch(() => {
        // Stay with defaults if config not found
      });
  }, [project]);

  // Persist density preference
  const toggleDensity = useCallback(() => {
    setCompact((prev) => {
      const next = !prev;
      localStorage.setItem("tasks_density", next ? "compact" : "rich");
      return next;
    });
  }, []);

  // Group by column_id
  const tasksByColumn = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const col of columns) {
      map[col.id] = sortTasks(tasks.filter((t) => t.column_id === col.id));
    }
    return map;
  }, [tasks, columns]);

  // Group by swimlane
  const swimlaneGroups = useMemo(() => {
    if (swimlane === "none") return { "": tasks };
    return groupTasks(tasks, swimlane);
  }, [tasks, swimlane]);

  const sortedSwimlaneKeys = useMemo(() => {
    return Object.keys(swimlaneGroups).sort((a, b) => {
      if (a === "Unassigned" || a === "No Epic" || a === "No Priority") return 1;
      if (b === "Unassigned" || b === "No Epic" || b === "No Priority") return -1;
      return a.localeCompare(b);
    });
  }, [swimlaneGroups]);

  // Find task by ID
  const findTask = useCallback(
    (id: string): Task | undefined => tasks.find((t) => t.id === id),
    [tasks]
  );

  const activeTask = activeId ? findTask(activeId) : null;

  // Drag handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      if (!over) return;

      const activeData = active.data.current;
      const taskId = active.id as string;
      const sourceCol = activeData?.columnId as string;
      const task = findTask(taskId);
      if (!task || !sourceCol) return;

      // Determine target column
      let targetCol: string | null = null;
      const overData = over.data.current;
      if (overData?.type === "column") {
        targetCol = overData.columnId as string;
      } else if (overData?.type === "card") {
        targetCol = overData.columnId as string;
      }

      if (!targetCol || targetCol === sourceCol) return;

      // Optimistic update
      const updated = tasks.map((t) =>
        t.id === taskId ? { ...t, column_id: targetCol! } : t
      );
      onTasksChange(updated);

      // Persist
      try {
        setError("");
        await api.tasks.move(taskId, targetCol, project);
      } catch {
        setError("Failed to move task. Please try again.");
        onTasksChange(tasks); // rollback
      }
    },
    [tasks, project, onTasksChange, findTask]
  );

  // Task updated from detail overlay
  const handleTaskUpdated = useCallback(
    (updated: Task) => {
      onTasksChange(tasks.map((t) => (t.id === updated.id ? updated : t)));
    },
    [tasks, onTasksChange]
  );

  // Build column display order
  const columnWipMap = useMemo(() => {
    const map: Record<string, number | undefined> = {};
    for (const col of columns) map[col.id] = col.wip_limit;
    return map;
  }, [columns]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <select
            value={swimlane}
            onChange={(e) => setSwimlane(e.target.value as SwimlaneMode)}
            className="border border-gray-200 rounded text-sm bg-white px-3 py-1.5 hover:bg-gray-50 cursor-pointer"
          >
            {(["none", "assignee", "epic", "priority"] as const).map((m) => (
              <option key={m} value={m}>
                {SWIMLANE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={toggleDensity}
          className="text-sm px-3 py-1.5 border border-gray-200 rounded bg-white hover:bg-gray-50 cursor-pointer"
        >
          {compact ? "Rich" : "Compact"}
        </button>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      {/* Board */}
      <DndContext
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="overflow-x-auto pb-4">
          {swimlane === "none" ? (
            /* Flat columns — no swimlanes */
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(240px, 1fr))` }}
            >
              {columns.map((col) => (
                <ColumnDroppable
                  key={col.id}
                  column={col}
                  tasks={tasksByColumn[col.id] ?? []}
                  compact={compact}
                  wipLimit={columnWipMap[col.id]}
                  onTaskClick={setSelectedTask}
                />
              ))}
            </div>
          ) : (
            /* Swimlanes: one row per group, each row has all columns */
            <div className="space-y-6">
              {sortedSwimlaneKeys.map((swimKey) => {
                const groupTasks = sortTasks(swimlaneGroups[swimKey] ?? []);
                if (groupTasks.length === 0) return null; // collapse empty
                return (
                  <div key={swimKey}>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2 px-1">
                      {swimKey}
                      <span className="text-xs text-gray-400 ml-1 font-normal">
                        ({groupTasks.length})
                      </span>
                    </h4>
                    <div
                      className="grid gap-4"
                      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(240px, 1fr))` }}
                    >
                      {columns.map((col) => {
                        const colTasks = sortTasks(
                          groupTasks.filter((t) => t.column_id === col.id)
                        );
                        return (
                          <ColumnDroppable
                            key={`${swimKey}-${col.id}`}
                            column={col}
                            tasks={colTasks}
                            compact={compact}
                            wipLimit={columnWipMap[col.id]}
                            onTaskClick={setSelectedTask}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DragOverlay>
          {activeTask ? <DragCard task={activeTask} /> : null}
        </DragOverlay>
      </DndContext>

      {/* Task detail overlay */}
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
