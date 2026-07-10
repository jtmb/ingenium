"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api, Task } from "../../lib/api";
import Overlay from "../components/Overlay";

/** Kanban-style column ordering: left to right workflow. */
const columns = ["todo", "in_progress", "review", "done"] as const;

/**
 * Kanban task board page.
 * Tasks are grouped by column. Clicking a task opens a detail overlay.
 * Each card has an "Advance →" button to move it to the next column.
 * A form at the top allows creating new tasks that start in "todo".
 */
export default function TasksPage() {
  const project = useProject();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  useEffect(() => { api.tasks.list(project).then((r) => setTasks(r.data)).catch(() => {}); }, [project]);

  /** Creates a new task (auto-placed in "todo") and prepends it. */
  const create = async () => {
    if (!title) return;
    try {
      setError("");
      const res = await api.tasks.create(title, project);
      setTasks([res.data, ...tasks]);
      setTitle("");
    } catch (err) {
      setError("Failed to create task. Please check that a project exists.");
    }
  };

  /** Moves a task to the target column, optimistically updating state. */
  const move = async (id: string, col: string) => {
    await api.tasks.move(id, col, project);
    setTasks(tasks.map((t) => t.id === id ? { ...t, column_id: col } : t));
  };

  /** Maps column IDs to Tailwind color classes for the status badge. */
  const columnColors: Record<string, string> = {
    todo: "bg-gray-100 text-gray-600",
    in_progress: "bg-blue-100 text-blue-700",
    review: "bg-amber-100 text-amber-700",
    done: "bg-green-100 text-green-700",
  };

  /** Advances a task to the next column in the workflow. */
  const handleAdvance = (task: Task) => {
    const advanceMap: Record<string, string> = {
      todo: "in_progress",
      in_progress: "review",
      review: "done",
      done: "todo",
    };
    const nextCol = advanceMap[task.column_id] ?? "todo";
    move(task.id, nextCol);
  };

  /** Groups tasks by their current column. */
  const grouped = Object.fromEntries(columns.map((c) => [c, tasks.filter((t) => t.column_id === c)]));

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Tasks</h1>
      <div className="flex gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" className="border p-2 rounded flex-1" />
        <button onClick={create} className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700">Add</button>
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      <div className="grid grid-cols-4 gap-4">
        {columns.map((col) => (
          <div key={col} className="bg-gray-100 p-3 rounded min-h-[200px]">
            <h3 className="font-medium text-sm uppercase mb-2">{col.replace("_", " ")}</h3>
            <div className="space-y-2">
              {(grouped[col] ?? []).map((t) => (
                <div
                  key={t.id}
                  className="bg-white p-2 rounded text-sm border hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => setSelectedTask(t)}
                >
                  <div className="font-medium truncate">{t.title}</div>
                  {t.assigned_to && <div className="text-xs text-gray-500 mt-1">{t.assigned_to}</div>}
                  <div className="flex items-center justify-between mt-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${columnColors[t.column_id] || "bg-gray-100 text-gray-600"}`}>
                      {t.column_id || "todo"}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAdvance(t); }}
                      className="text-xs text-blue-600 hover:text-blue-800"
                      title="Advance to next column"
                    >
                      Advance →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Overlay
        isOpen={selectedTask !== null}
        onClose={() => setSelectedTask(null)}
        title={selectedTask?.title ?? ""}
        subtitle={`Status: ${selectedTask?.column_id ?? "todo"}`}
      >
        {selectedTask && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-semibold">Assigned to:</span>{" "}
                <span className="text-gray-600">{selectedTask.assigned_to || "Unassigned"}</span>
              </div>
              <div>
                <span className="font-semibold">Created:</span>{" "}
                <span className="text-gray-600">{new Date(selectedTask.created_at).toLocaleString()}</span>
              </div>
              {selectedTask.completed_at && (
                <div>
                  <span className="font-semibold">Completed:</span>{" "}
                  <span className="text-gray-600">{new Date(selectedTask.completed_at).toLocaleString()}</span>
                </div>
              )}
            </div>
            {selectedTask.description && (
              <div>
                <h3 className="font-semibold mb-1">Description</h3>
                <pre className="bg-gray-50 p-3 rounded border text-sm whitespace-pre-wrap font-sans">
                  {selectedTask.description}
                </pre>
              </div>
            )}
          </div>
        )}
      </Overlay>
    </div>
  );
}
