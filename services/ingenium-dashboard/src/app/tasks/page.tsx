"use client";
import { useState, useEffect } from "react";
import { api, Task } from "../../lib/api";

/** Kanban-style column ordering: left to right workflow. */
const columns = ["todo", "in_progress", "review", "done"] as const;

/**
 * Kanban task board page.
 * Tasks are grouped by column. Clicking a task advances it to the next column.
 * A form at the top allows creating new tasks that start in "todo".
 */
export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { api.tasks.list().then((r) => setTasks(r.data)).catch(() => {}); }, []);

  /** Creates a new task (auto-placed in "todo") and prepends it. */
  const create = async () => {
    if (!title) return;
    try {
      setError("");
      const res = await api.tasks.create(title);
      setTasks([res.data, ...tasks]);
      setTitle("");
    } catch (err) {
      setError("Failed to create task. Please check that a project exists.");
    }
  };

  /** Moves a task to the target column, optimistically updating state. */
  const move = async (id: string, col: string) => {
    await api.tasks.move(id, col);
    setTasks(tasks.map((t) => t.id === id ? { ...t, column_id: col } : t));
  };

  /** Groups tasks by their current column. */
  const grouped = Object.fromEntries(columns.map((c) => [c, tasks.filter((t) => t.column_id === c)]));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Tasks</h1>
      <div className="flex gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" className="border p-2 rounded flex-1" />
        <button onClick={create} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Add</button>
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      <div className="grid grid-cols-4 gap-4">
        {columns.map((col) => (
          <div key={col} className="bg-gray-100 p-3 rounded min-h-[200px]">
            <h3 className="font-medium text-sm uppercase mb-2">{col.replace("_", " ")}</h3>
            <div className="space-y-2">
              {(grouped[col] ?? []).map((t) => (
                <div key={t.id} className="bg-white p-2 rounded text-sm border cursor-pointer hover:shadow"
                     onClick={() => {
                       // Modulo arithmetic guarantees a valid index (0..3) for 4-element columns array
                        const nextCol = columns[(columns.indexOf(col) + 1) % columns.length]!;
                        move(t.id, nextCol);
                     }}>
                  {t.title}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
