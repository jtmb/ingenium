"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useProject } from "../../lib/ProjectContext";
import { api, Task } from "../../lib/api";

import BoardView from "./components/BoardView";
import ListView from "./components/ListView";
import TimelineView from "./components/TimelineView";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type ViewMode = "board" | "list" | "timeline";

const VIEW_OPTIONS: { mode: ViewMode; label: string }[] = [
  { mode: "board", label: "Board" },
  { mode: "list", label: "List" },
  { mode: "timeline", label: "Timeline" },
];

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

/**
 * Task board page with view switcher (Board / List / Timeline).
 * View mode is persisted via the `?view=` query parameter.
 */
export default function TasksPage() {
  const project = useProject();
  const searchParams = useSearchParams();
  const router = useRouter();

  const viewFromQuery = (searchParams.get("view") as ViewMode) || "board";
  const [view, setView] = useState<ViewMode>(
    ["board", "list", "timeline"].includes(viewFromQuery) ? viewFromQuery : "board"
  );

  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  // Fetch tasks
  useEffect(() => {
    api.tasks.list(project).then((r) => setTasks(r.data ?? [])).catch(() => {});
  }, [project]);

  // Sync view state to URL
  const switchView = useCallback(
    (mode: ViewMode) => {
      setView(mode);
      const params = new URLSearchParams(searchParams.toString());
      params.set("view", mode);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [searchParams, router]
  );

  // Create new task
  const create = async () => {
    if (!title.trim()) return;
    try {
      setError("");
      const res = await api.tasks.create(title.trim(), project);
      setTasks((prev) => [res.data, ...prev]);
      setTitle("");
    } catch {
      setError("Failed to create task. Please check that a project exists.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header + create form */}
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">Tasks</h1>

        {/* Create task inline row */}
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Task title"
            className="border border-gray-200 rounded px-3 py-2 flex-1 text-sm"
          />
          <button
            onClick={create}
            className="bg-blue-600 text-white py-2 px-4 rounded text-sm hover:bg-blue-700"
          >
            Add
          </button>
        </div>
        {error && <div className="text-red-600 text-sm">{error}</div>}
      </div>

      {/* View switcher */}
      <div className="flex gap-1 border-b border-gray-200">
        {VIEW_OPTIONS.map(({ mode, label }) => (
          <button
            key={mode}
            onClick={() => switchView(mode)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              view === mode
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Active view */}
      {view === "board" && (
        <BoardView
          project={project}
          tasks={tasks}
          onTasksChange={setTasks}
        />
      )}
      {view === "list" && (
        <ListView
          project={project}
          tasks={tasks}
          onTasksChange={setTasks}
        />
      )}
      {view === "timeline" && (
        <TimelineView
          project={project}
          tasks={tasks}
          onTasksChange={setTasks}
        />
      )}
    </div>
  );
}
