"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, Task, BoardColumn, BoardConfig } from "../../../lib/api";
import { badgeTones } from "../../../lib/badgeTones";
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

const PRIORITY_OPTIONS = [
  { id: "critical", label: "Critical" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-amber-400 text-amber-900",
  low: "bg-green-500 text-white",
};

function columnBadgeTones(columnId: string): string {
  switch (columnId) {
    case "in_progress": return badgeTones("blue");
    case "review":      return badgeTones("amber");
    case "done":        return badgeTones("green");
    default:            return badgeTones("slate");
  }
}

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
  onDelete,
  bulkMode,
  isSelected,
  onToggleSelect,
}: {
  task: Task;
  compact: boolean;
  onClick: (t: Task) => void;
  onDelete?: (id: string) => void;
  bulkMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
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
    "bg-[var(--color-surface)] border border-[var(--color-border)] rounded hover:shadow-md transition-shadow cursor-pointer";

  if (compact) {
    return (
      <div ref={setNodeRef} style={style} {...attributes} {...listeners}
        className={`${baseCard} p-1.5 text-xs relative group`}
        onClick={() => onClick(task)}
      >
        {bulkMode && (
          <input type="checkbox" checked={isSelected ?? false}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSelect?.(task.id)}
            className="absolute top-1 left-1 rounded" />
        )}
        <div className={`font-medium truncate ${bulkMode ? "pl-4" : "pr-10"}`}>{task.title}</div>
        {/* Quick actions (hover) */}
        <div className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onClick(task); }}
            className="p-0.5 rounded hover:bg-[var(--color-surface-hover)] text-[10px] leading-none"
            title="Edit"
          >
            ✏️
          </button>
          {onDelete && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
              className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/20 text-[10px] leading-none"
              title="Delete"
            >
              🗑️
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`${baseCard} p-3 text-sm space-y-1.5 relative group`}
      onClick={() => onClick(task)}
    >
      {bulkMode && (
        <input type="checkbox" checked={isSelected ?? false}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleSelect?.(task.id)}
          className="absolute top-2 left-2 rounded z-10" />
      )}
      <div className={`font-semibold text-[var(--color-text-primary)] truncate ${bulkMode ? "pl-5" : "pr-10"}`}>{task.title}</div>
      <div className="flex items-center gap-2 flex-wrap">
        {task.priority && (
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLORS[task.priority] || "bg-gray-200 text-[var(--color-text-secondary)]"}`}>
            {task.priority}
          </span>
        )}
        {task.issue_type && (
          <span className="text-xs text-[var(--color-text-muted)]">{task.issue_type}</span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap text-xs text-[var(--color-text-muted)]">
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
      {/* Quick actions (hover) */}
      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onClick(task); }}
          className="p-1 rounded hover:bg-[var(--color-surface-hover)] text-xs"
          title="Edit"
        >
          ✏️
        </button>
        {onDelete && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
            className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/20 text-xs"
            title="Delete"
          >
            🗑️
          </button>
        )}
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
  onCreateTask,
  onDeleteTask,
  bulkMode,
  selectedIds,
  onToggleSelect,
}: {
  column: BoardColumn;
  tasks: Task[];
  compact: boolean;
  wipLimit?: number;
  onTaskClick: (t: Task) => void;
  onCreateTask?: (columnId: string, title: string) => Promise<void>;
  onDeleteTask?: (id: string) => void;
  bulkMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col-${column.id}`,
    data: { type: "column", columnId: column.id },
  });

  const [showAddInput, setShowAddInput] = useState(false);
  const [addTitle, setAddTitle] = useState("");

  const handleAddSubmit = async () => {
    if (!addTitle.trim() || !onCreateTask) return;
    try {
      await onCreateTask(column.id, addTitle.trim());
      setAddTitle("");
      setShowAddInput(false);
    } catch {
      // Parent handles error display — leave input open for retry
    }
  };

  const threshold = wipLimit != null && tasks.length >= wipLimit;

  return (
    <div
      ref={setNodeRef}
      className={`bg-[var(--color-surface)] rounded min-h-[160px] flex flex-col transition-colors border border-[var(--color-border)] ${isOver ? "bg-[var(--color-surface-selected)] ring-2 ring-blue-300" : ""}`}
    >
      {/* Column header */}
      <div
        className={`px-3 py-2 border-b border-[var(--color-border)] font-medium text-sm uppercase flex items-center justify-between ${
          threshold ? `${badgeTones("red")}` : "text-[var(--color-text-secondary)]"
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
            <SortableCard key={t.id} task={t} compact={compact} onClick={onTaskClick}
              onDelete={onDeleteTask}
              bulkMode={bulkMode} isSelected={selectedIds?.has(t.id)} onToggleSelect={onToggleSelect} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <p className="text-xs text-[var(--color-text-muted)] italic p-2">No tasks</p>
        )}
      </div>

      {/* Inline add form */}
      <div className="px-2 pb-2">
        {showAddInput ? (
          <div className="flex gap-1">
            <input
              autoFocus
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddSubmit();
                if (e.key === "Escape") { setShowAddInput(false); setAddTitle(""); }
              }}
              placeholder="Task title..."
              className="border border-[var(--color-border)] rounded px-2 py-1 text-xs flex-1"
            />
            <button
              onClick={handleAddSubmit}
              className="bg-blue-600 text-white px-2 py-1 rounded text-xs hover:bg-blue-700"
            >
              Add
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddInput(true)}
            className="w-full text-left px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded"
          >
            + Add card
          </button>
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
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-3 text-sm shadow-lg w-56">
      <div className="font-semibold text-[var(--color-text-primary)] truncate">{task.title}</div>
      {task.priority && (
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLORS[task.priority] || "bg-gray-200 text-[var(--color-text-secondary)]"}`}>
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
  // dnd-kit sensors with an 8px activation distance so clicks fire onClick
  // instead of being swallowed by the drag listeners.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

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

  // Bulk edit state
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkColumn, setBulkColumn] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [bulkPriority, setBulkPriority] = useState("");

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

  // Open a different task in the detail overlay (for dependency navigation)
  const handleOpenTask = useCallback((t: Task) => {
    setSelectedTask(t);
  }, []);

  // Bulk edit toggle card selection
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Bulk apply
  const handleBulkApply = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const taskIds = Array.from(selectedIds);
    try {
      setError("");
      await api.tasks.bulkUpdate({
        task_ids: taskIds,
        column_id: bulkColumn || undefined,
        assigned_to: bulkAssignee || undefined,
        priority: bulkPriority || undefined,
      }, project);
      // Refresh from server
      const res = await api.tasks.list(project);
      onTasksChange(res.data ?? []);
      setSelectedIds(new Set());
    } catch {
      setError("Bulk update failed. Please try again.");
    }
  }, [selectedIds, bulkColumn, bulkAssignee, bulkPriority, project, onTasksChange]);

  // Inline add task to a specific column
  const handleAddTask = useCallback(async (columnId: string, title: string) => {
    setError("");
    const res = await api.tasks.create(title, project);
    if (columnId !== "todo") {
      await api.tasks.move(res.data.id, columnId, project);
    }
    const updated = await api.tasks.list(project);
    onTasksChange(updated.data ?? []);
  }, [project, onTasksChange]);

  // Delete a task
  const handleDeleteTask = useCallback(async (taskId: string) => {
    try {
      setError("");
      await api.tasks.delete(taskId, project);
      onTasksChange(tasks.filter((t) => t.id !== taskId));
    } catch {
      setError("Failed to delete task.");
    }
  }, [tasks, project, onTasksChange]);

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
            className="border border-[var(--color-border)] rounded text-sm bg-[var(--color-surface)] px-3 py-1.5 hover:bg-[var(--color-surface-hover)] cursor-pointer"
          >
            {(["none", "assignee", "epic", "priority"] as const).map((m) => (
              <option key={m} value={m}>
                {SWIMLANE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()); }}
            className={`text-sm px-3 py-1.5 border border-[var(--color-border)] rounded cursor-pointer ${
              bulkMode
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-[var(--color-surface)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
            }`}
          >
            {bulkMode ? "Bulk Edit ✓" : "Bulk Edit"}
          </button>
          <button
            onClick={toggleDensity}
            className="text-sm px-3 py-1.5 border border-[var(--color-border)] rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
          >
            {compact ? "Rich" : "Compact"}
          </button>
        </div>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      {/* Bulk edit floating action bar */}
      {bulkMode && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-[var(--color-surface)] border border-blue-200 rounded p-3 shadow-lg sticky bottom-0 z-10 flex-wrap">
          <span className="text-sm font-medium text-[var(--color-text-primary)]">{selectedIds.size} selected</span>
          <select value={bulkColumn} onChange={(e) => setBulkColumn(e.target.value)}
            className="border border-[var(--color-border)] rounded text-sm bg-[var(--color-surface)] px-2 py-1 hover:bg-[var(--color-surface-hover)] cursor-pointer">
            <option value="">Move to...</option>
            {columns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
          <input value={bulkAssignee} onChange={(e) => setBulkAssignee(e.target.value)}
            placeholder="Assign to..." className="border border-[var(--color-border)] rounded px-2 py-1 text-sm w-32" />
          <select value={bulkPriority} onChange={(e) => setBulkPriority(e.target.value)}
            className="border border-[var(--color-border)] rounded text-sm bg-[var(--color-surface)] px-2 py-1 hover:bg-[var(--color-surface-hover)] cursor-pointer">
            <option value="">Set Priority...</option>
            {PRIORITY_OPTIONS.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
          </select>
          <button onClick={handleBulkApply}
            className="bg-blue-600 text-white py-1.5 px-4 rounded text-sm hover:bg-blue-700">Apply</button>
          <button onClick={() => setSelectedIds(new Set())}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-sm">Clear</button>
        </div>
      )}

      {/* Board */}
      <DndContext
        sensors={sensors}
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
                  onCreateTask={handleAddTask}
                  onDeleteTask={handleDeleteTask}
                  bulkMode={bulkMode}
                  selectedIds={selectedIds}
                  onToggleSelect={handleToggleSelect}
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
                    <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2 px-1">
                      {swimKey}
                      <span className="text-xs text-[var(--color-text-muted)] ml-1 font-normal">
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
                            onCreateTask={handleAddTask}
                            onDeleteTask={handleDeleteTask}
                            bulkMode={bulkMode}
                            selectedIds={selectedIds}
                            onToggleSelect={handleToggleSelect}
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
          onTaskClick={handleOpenTask}
        />
      )}
    </div>
  );
}
