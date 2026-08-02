"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useProject } from "../../lib/ProjectContext";
import { api, Task } from "../../lib/api";

import BoardView from "./components/BoardView";
import ListView from "./components/ListView";
import TimelineView from "./components/TimelineView";
import SpotlightSearch from "./components/SpotlightSearch";
import NotificationBell from "./components/NotificationBell";
import TaskDetail from "./components/TaskDetail";
import TaskCreateModal from "./components/TaskCreateModal";

type ViewMode = "board" | "list" | "timeline";

const VIEW_OPTIONS: { mode: ViewMode; label: string }[] = [
  { mode: "board", label: "Board" },
  { mode: "list", label: "List" },
  { mode: "timeline", label: "Timeline" },
];

/**
 * TasksPage — Kanban board with view switcher (Board / List / Timeline).
 *
 * View mode is persisted via the `?view=` query parameter so browser
 * back/forward navigation preserves the user's preferred layout.
 *
 * Wrapped in <Suspense> because useProject() (via ProjectContext)
 * internally calls useSearchParams(), which requires a Suspense
 * boundary in Next.js 15+.
 *
 * The search filter is client-side (case-insensitive substring match on
 * title + description) since the task list is typically small enough
 * (< 500 items) that server-side filtering would add unnecessary latency.
 */
export default function TasksPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading tasks…</div>}>
      <TasksContent />
    </Suspense>
  );
}

function TasksContent() {
  const project = useProject();
  const searchParams = useSearchParams();
  const router = useRouter();

  const viewFromQuery = (searchParams.get("view") as ViewMode) || "board";
  const [view, setView] = useState<ViewMode>(
    ["board", "list", "timeline"].includes(viewFromQuery) ? viewFromQuery : "board"
  );

  const [tasks, setTasks] = useState<Task[]>([]);
  const [search, setSearch] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);

  const [detailTask, setDetailTask] = useState<Task | null>(null);

  useEffect(() => {
    api.tasks.list(project).then((r) => setTasks(r.data ?? [])).catch(() => {});
  }, [project]);

  const switchView = useCallback(
    (mode: ViewMode) => {
      setView(mode);
      const params = new URLSearchParams(searchParams.toString());
      params.set("view", mode);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [searchParams, router]
  );

  // Client-side search filter — case-insensitive substring match on title + description
  const filteredTasks = useMemo(() => {
    if (!search.trim()) return tasks;
    const q = search.toLowerCase();
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q)
    );
  }, [tasks, search]);

  const handleSpotlightSelect = useCallback((task: Task) => {
    setDetailTask(task);
  }, []);

  const handleNotificationClick = useCallback((taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) setDetailTask(task);
  }, [tasks]);

  const handleTaskUpdated = useCallback((updated: Task) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }, []);

  return (
    <div className="space-y-6 min-w-0">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Tasks</h1>
          <div className="flex items-center gap-2">
            <NotificationBell project={project} onTaskClick={handleNotificationClick} />
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="border border-[var(--color-border)] rounded px-3 py-2 min-w-0 w-full sm:flex-1 text-sm"
          />
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-blue-600 text-white py-2 px-4 rounded text-sm hover:bg-blue-700 w-full sm:w-auto shrink-0"
          >
            + Add Task
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {VIEW_OPTIONS.map(({ mode, label }) => (
          <button
            key={mode}
            onClick={() => switchView(mode)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              view === mode
                ? "border-blue-600 text-[var(--color-text-link)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-gray-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "board" && (
        <BoardView
          project={project}
          tasks={filteredTasks}
          onTasksChange={setTasks}
        />
      )}
      {view === "list" && (
        <ListView
          project={project}
          tasks={filteredTasks}
          onTasksChange={setTasks}
        />
      )}
      {view === "timeline" && (
        <TimelineView
          project={project}
          tasks={filteredTasks}
          onTasksChange={setTasks}
        />
      )}

      <SpotlightSearch project={project} onTaskSelect={handleSpotlightSelect} />

      <TaskCreateModal
        isOpen={isModalOpen}
        project={project}
        onClose={() => setIsModalOpen(false)}
        onCreated={(newTask) => {
          setTasks((prev) => [newTask, ...prev]);
        }}
      />

      {detailTask && (
        <TaskDetail
          task={detailTask}
          project={project}
          onClose={() => setDetailTask(null)}
          onTaskUpdated={handleTaskUpdated}
          onTaskClick={setDetailTask}
        />
      )}
    </div>
  );
}
