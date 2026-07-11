"use client";

import { useState, useMemo, useCallback } from "react";
import { api, Task } from "../../../lib/api";
import TaskDetail from "./TaskDetail";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

type SortField = "id" | "title" | "column_id" | "assigned_to" | "priority" | "due_date" | "issue_type" | "created_at";
type SortDir = "asc" | "desc";

const FIELD_LABELS: Record<SortField, string> = {
  id: "ID",
  title: "Title",
  column_id: "Status",
  assigned_to: "Assignee",
  priority: "Priority",
  due_date: "Due Date",
  issue_type: "Type",
  created_at: "Created",
};

const COLUMN_LABELS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

/* ------------------------------------------------------------------ */
/*  Inline Editable Cell                                               */
/* ------------------------------------------------------------------ */

function EditableCell({
  value,
  onSave,
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleBlur = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      setEditing(false);
      if (draft !== value) onSave(draft);
    }
    if (e.key === "Escape") {
      setDraft(value);
      setEditing(false);
    }
  };

  return editing ? (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className="border border-gray-300 rounded px-1 py-0.5 text-sm w-full"
      placeholder={placeholder}
    />
  ) : (
    <span
      className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded inline-block min-w-[2rem]"
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {value || <span className="text-gray-400 italic">{placeholder ?? "—"}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Sortable header                                                    */
/* ------------------------------------------------------------------ */

function SortHeader({
  field,
  currentSort,
  currentDir,
  onSort,
  label,
  className,
}: {
  field: SortField;
  currentSort: SortField;
  currentDir: SortDir;
  onSort: (f: SortField) => void;
  label: string;
  className?: string;
}) {
  const active = currentSort === field;
  return (
    <th
      className={`px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase cursor-pointer select-none hover:bg-gray-100 ${className ?? ""}`}
      onClick={() => onSort(field)}
    >
      {label}
      {active && <span className="ml-1">{currentDir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

/* ------------------------------------------------------------------ */
/*  List View                                                         */
/* ------------------------------------------------------------------ */

type ListViewProps = {
  project: string;
  tasks: Task[];
  onTasksChange: (tasks: Task[]) => void;
};

export default function ListView({ project, tasks, onTasksChange }: ListViewProps) {
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDir("asc");
      }
    },
    [sortField]
  );

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      let av: any = a[sortField as keyof Task] ?? "";
      let bv: any = b[sortField as keyof Task] ?? "";
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (av == null) av = "";
      if (bv == null) bv = "";
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [tasks, sortField, sortDir]);

  const handleInlineUpdate = useCallback(
    async (taskId: string, field: keyof Task, value: string) => {
      const updated = tasks.map((t) =>
        t.id === taskId ? { ...t, [field]: value || undefined } : t
      );
      onTasksChange(updated);
      try {
        await api.tasks.update(taskId, { [field]: value || undefined }, project);
      } catch {
        onTasksChange(tasks); // rollback on error
      }
    },
    [tasks, project, onTasksChange]
  );

  const handleTaskUpdated = useCallback(
    (updated: Task) => {
      onTasksChange(tasks.map((t) => (t.id === updated.id ? updated : t)));
    },
    [tasks, onTasksChange]
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {([
              ["id", "ID"],
              ["title", "Title"],
              ["column_id", "Status"],
              ["assigned_to", "Assignee"],
              ["priority", "Priority"],
              ["due_date", "Due Date"],
              ["issue_type", "Type"],
              ["created_at", "Created"],
            ] as [SortField, string][]).map(([field, label]) => (
              <SortHeader
                key={field}
                field={field}
                label={label}
                currentSort={sortField}
                currentDir={sortDir}
                onSort={handleSort}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedTasks.map((t) => (
            <tr
              key={t.id}
              className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
              onClick={() => setSelectedTask(t)}
            >
              <td className="px-3 py-2 font-mono text-xs text-gray-500">
                {t.id.slice(0, 8)}
              </td>
              <td className="px-3 py-2">
                <EditableCell
                  value={t.title}
                  onSave={(v) => handleInlineUpdate(t.id, "title", v)}
                  placeholder="Untitled"
                />
              </td>
              <td className="px-3 py-2">
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  t.column_id === "done"
                    ? "bg-green-100 text-green-700"
                    : t.column_id === "in_progress"
                      ? "bg-blue-100 text-blue-700"
                      : t.column_id === "review"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-gray-100 text-gray-600"
                }`}>
                  {COLUMN_LABELS[t.column_id] || t.column_id || "todo"}
                </span>
              </td>
              <td className="px-3 py-2">
                <EditableCell
                  value={t.assigned_to ?? ""}
                  onSave={(v) => handleInlineUpdate(t.id, "assigned_to", v)}
                  placeholder="Unassigned"
                />
              </td>
              <td className="px-3 py-2">
                <EditableCell
                  value={t.priority ?? ""}
                  onSave={(v) => handleInlineUpdate(t.id, "priority", v)}
                  placeholder="—"
                />
              </td>
              <td className="px-3 py-2 text-gray-500 text-xs">
                {t.due_date
                  ? new Date(t.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : "—"}
              </td>
              <td className="px-3 py-2 text-gray-500">
                {t.issue_type || "—"}
              </td>
              <td className="px-3 py-2 text-gray-500 text-xs">
                {new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </td>
            </tr>
          ))}
          {sortedTasks.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                No tasks yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

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
