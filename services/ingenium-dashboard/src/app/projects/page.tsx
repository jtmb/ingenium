"use client";
export const dynamic = "force-dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProject, persistProject } from "../../lib/ProjectContext";
import { api, Project } from "../../lib/api";
import { badgeTones } from "../../lib/badgeTones";
import { formatRelativeTime } from "../../lib/time";
import Overlay from "../components/Overlay";

/**
 * ProjectsPage — Multi-project management (create, rename, archive, restore, delete).
 *
 * Fetches project detail (skills count, observation stats, pipeline events)
 * for ALL active projects in parallel on mount via Promise.all. This is a
 * deliberate design choice: the project list is small (typically < 20) and
 * showing rich stats inline avoids the complexity of lazy-loading per card.
 *
 * Archived projects are kept separate — restore brings them back to active.
 * Purge is a soft-delete confirmation with a warning overlay.
 */
type CollectionState = "loading" | "success" | "error";
type ProjectDetailState = {
  status: CollectionState;
  data?: any;
  error?: string;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [archived, setArchived] = useState<Project[]>([]);
  const [activeState, setActiveState] = useState<CollectionState>("loading");
  const [archivedState, setArchivedState] = useState<CollectionState>("loading");
  const [activeError, setActiveError] = useState<string | null>(null);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<"active" | "archived">("active");
  const [details, setDetails] = useState<Record<string, ProjectDetailState>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [renameProject, setRenameProject] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const activeProject = useProject();
  const [activeName, setActiveName] = useState(activeProject);
  const loadRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setActiveState("loading");
    setArchivedState("loading");
    setActiveError(null);
    setArchivedError(null);

    const [activeResult, archivedResult] = await Promise.allSettled([
      api.projects.list(),
      api.projects.listArchived(),
    ]);
    if (requestId !== loadRequestRef.current) return;

    if (activeResult.status === "fulfilled") {
      setProjects((activeResult.value.data ?? []).filter((project) => !project.archived_at));
      setActiveState("success");
    } else {
      setProjects([]);
      setActiveError(activeResult.reason instanceof Error ? activeResult.reason.message : "Unable to load active projects");
      setActiveState("error");
    }

    if (archivedResult.status === "fulfilled") {
      setArchived(archivedResult.value.data ?? []);
      setArchivedState("success");
    } else {
      setArchived([]);
      setArchivedError(archivedResult.reason instanceof Error ? archivedResult.reason.message : "Unable to load archived projects");
      setArchivedState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setActiveName(activeProject); }, [activeProject]);

  // Fetch details for all active projects in parallel
  useEffect(() => {
    const requestId = ++detailRequestRef.current;
    if (projects.length === 0) {
      setDetails({});
      return;
    }

    setDetails((previous) => Object.fromEntries(projects.map((project) => [
      project.name,
      { status: "loading", data: previous[project.name]?.data },
    ])));

    void Promise.allSettled(projects.map(async (project) => ({
      name: project.name,
      data: (await api.projects.detail(project.name)).data,
    }))).then((results) => {
      if (requestId !== detailRequestRef.current) return;
      setDetails((previous) => {
        const next = { ...previous };
        for (const result of results) {
          if (result.status === "fulfilled") {
            next[result.value.name] = { status: "success", data: result.value.data };
          } else {
            const failedProject = projects[results.indexOf(result)];
            if (!failedProject) continue;
            next[failedProject.name] = {
              status: "error",
              error: result.reason instanceof Error ? result.reason.message : "Unable to load project details",
            };
          }
        }
        return next;
      });
    });
  }, [projects]);

  const create = async () => {
    if (!name) return;
    await api.projects.create(name);
    setName("");
    await load();
  };

  const archive = async (n: string) => { await api.projects.archive(n); await load(); };
  const restore = async (n: string) => { await api.projects.restore(n); await load(); };
  const rename = async (oldName: string, newName = renameValue.trim()) => {
    if (newName && newName !== oldName) {
      await api.projects.update(oldName, newName);
      setRenameProject(null); setRenameValue("");
      await load();
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await api.projects.purgeOne(name);
      setConfirmDelete(null);
      await load();
    } catch {
      setActionError("The project could not be deleted.");
      setConfirmDelete(null);
    }
  };

  const displayed = (view === "active" ? projects : archived)
    .filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const selectedState = view === "active" ? activeState : archivedState;
  const selectedError = view === "active" ? activeError : archivedError;

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="min-w-0 break-words text-3xl font-bold">Projects</h1>
        <button onClick={() => setShowCreate(true)} className="w-full rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 sm:w-auto">+ New Project</button>
      </div>

      {/* View toggle + search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 items-center">
          <button onClick={() => setView("active")} className={`px-3 py-1 rounded text-sm font-medium ${view === "active" ? "bg-blue-600 text-white" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"}`}>Active</button>
          <button onClick={() => setView("archived")} className={`px-3 py-1 rounded text-sm font-medium ${view === "archived" ? "bg-blue-600 text-white" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"}`}>Archived</button>
        </div>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search projects..."
          className="w-full min-w-0 rounded border border-[var(--color-border)] p-2 text-sm sm:w-64"
        />
      </div>

      <div className="space-y-3">
        {actionError && <p role="alert" className="rounded bg-[var(--color-error-bg)] p-3 text-sm text-[var(--color-error-text)]">{actionError}</p>}
        {selectedState === "loading" ? (
          <p className="py-8 text-center text-[var(--color-text-muted)]" aria-busy="true">Loading {view} projects...</p>
        ) : selectedState === "error" ? (
          <div className="rounded border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-6 text-center" role="alert">
            <p className="text-sm text-[var(--color-error-text)]">Unable to load {view} projects: {selectedError}</p>
            <button type="button" onClick={() => void load()} className="mt-3 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">Retry</button>
          </div>
        ) : displayed.length === 0 ? (
          <p className="py-8 text-center text-[var(--color-text-muted)]">No {view} projects.</p>
        ) : displayed.map((p) => {
          const detailState = details[p.name] ?? { status: "loading" as const };
          const d = detailState.status === "success" ? detailState.data : undefined;
          const synth = d?.latest_synthesis;
          const synthCount = synth ? formatRelativeTime(synth) : "—";
          const isExpanded = expanded === p.name;
          const detailId = `project-detail-${p.id}`;

          return (
            <div key={p.id} className="min-w-0 overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:shadow-md transition-shadow">
              <div className="flex flex-col items-start gap-3 border-b border-[var(--color-border-muted)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : p.name)}
                  className="min-w-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
                  aria-label={`${isExpanded ? "Hide" : "View"} details for ${p.name}`}
                  aria-expanded={isExpanded}
                  aria-controls={detailId}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="break-all text-lg font-semibold">{p.name}</span>
                    {!!p.is_global && <span className={`text-xs ${badgeTones("blue")} rounded px-2 py-0.5 font-medium`}>GLOBAL</span>}
                    {!p.archived_at && p.name === activeName && <span className={`text-xs ${badgeTones("green")} rounded px-2 py-0.5 font-medium`}>ACTIVE</span>}
                    {p.archived_at && <span className={`text-xs ${badgeTones("error")} rounded px-2 py-0.5 font-medium`}>ARCHIVED</span>}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">Created {formatRelativeTime(p.created_at)}</span>
                </button>
                <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
                  {view === "active" ? (
                    <>
                      {p.name !== activeName && <button type="button" onClick={() => { persistProject(p.name); setActiveName(p.name); }} className="flex-1 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] sm:flex-none">Set Active</button>}
                       <button type="button" onClick={() => { setRenameProject(p.name); setRenameValue(p.name); }} className="flex-1 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] sm:flex-none">Rename</button>
                      <button type="button" onClick={() => void archive(p.name)} className="flex-1 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-error-text)] hover:bg-[var(--color-error-bg)] sm:flex-none">Archive</button>
                    </>
                  ) : (
                    <div className="flex w-full gap-2 sm:w-auto">
                      <button type="button" onClick={() => void restore(p.name)} className="flex-1 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-success-text)] hover:bg-[var(--color-success-bg)] sm:flex-none">Restore</button>
                      <button type="button" onClick={() => setConfirmDelete(p.name)} className="flex-1 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-error-text)] hover:bg-[var(--color-error-bg)] sm:flex-none">Delete</button>
                    </div>
                  )}
                </div>
              </div>

              {view === "active" && (
                detailState.status === "loading" ? (
                  <p className="px-5 py-3 text-sm text-[var(--color-text-muted)]" aria-busy="true">Loading project details...</p>
                ) : detailState.status === "error" ? (
                  <p className="px-5 py-3 text-sm text-[var(--color-error-text)]" role="alert">Project details unavailable: {detailState.error}</p>
                ) : (
                  <div className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
                    <div className="text-[var(--color-text-muted)]"><span className="font-semibold text-[var(--color-text-primary)]">{d?.skills_count ?? 0}</span> Skills</div>
                    <div className="text-[var(--color-text-muted)]"><span className="font-semibold text-[var(--color-text-primary)]">{d?.observation_stats?.total ?? 0}</span> Observations{d?.observation_stats?.pending > 0 && <span className="ml-1 text-amber-500">({d.observation_stats.pending} pending)</span>}</div>
                    <div className="text-[var(--color-text-muted)]"><span className="font-semibold text-[var(--color-text-primary)]">{d?.pipeline?.length ?? 0}</span> Pipeline events</div>
                    <div className="text-[var(--color-text-muted)]">Last synthesis: <span className="font-medium text-[var(--color-text-primary)]">{synthCount}</span></div>
                    <div className="hidden flex-1 sm:block" />
                    {p.path && <div className="max-w-full break-all text-xs text-[var(--color-text-muted)] sm:max-w-[200px] sm:truncate" title={p.path}>{p.path}</div>}
                  </div>
                )
              )}

              {isExpanded && (
                <div id={detailId} className="border-t border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] px-5 py-4">
                  {view !== "active" ? (
                    <p className="text-sm text-[var(--color-text-muted)]">Archived project details are unavailable.</p>
                  ) : detailState.status === "loading" ? (
                    <p className="text-sm text-[var(--color-text-muted)]" aria-busy="true">Loading project details...</p>
                  ) : detailState.status === "error" ? (
                    <p className="text-sm text-[var(--color-error-text)]" role="alert">Project details unavailable: {detailState.error}</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                      <div>
                        <h3 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">Recent Skills</h3>
                        {d?.recent_skills?.length > 0 ? <div className="space-y-1">{d.recent_skills.slice(0, 5).map((skill: any) => <div key={skill.name} className="flex min-w-0 justify-between gap-2 text-sm"><span className="min-w-0 break-all text-[var(--color-text-link)]">{skill.name}</span><span className="shrink-0 text-xs text-[var(--color-text-muted)]">{formatRelativeTime(skill.created_at)}</span></div>)}</div> : <p className="text-xs text-[var(--color-text-muted)]">No skills yet.</p>}
                      </div>
                      <div>
                        <h3 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">Recent Observations</h3>
                        {d?.observation_stats?.recent?.length > 0 ? <div className="space-y-1">{d.observation_stats.recent.slice(0, 5).map((observation: any, index: number) => <div key={index} className="flex min-w-0 justify-between gap-2 text-xs"><span className="min-w-0 break-words text-[var(--color-text-secondary)] sm:max-w-[200px] sm:truncate">{observation.content?.substring(0, 80)}</span><span className="ml-2 shrink-0 text-[var(--color-text-muted)]">{formatRelativeTime(observation.created_at)}</span></div>)}</div> : <p className="text-xs text-[var(--color-text-muted)]">No observations yet.</p>}
                      </div>
                      <div className="sm:col-span-2">
                        <h3 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">Recent Pipeline Activity</h3>
                        {d?.pipeline?.length > 0 ? <div className="space-y-1">{d.pipeline.map((event: any) => <div key={event.created_at} className="flex min-w-0 gap-3 text-xs"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${event.event_type?.startsWith("synthesis") ? badgeTones("emerald") : event.event_type?.startsWith("trait") ? badgeTones("blue") : event.event_type?.startsWith("obs") ? badgeTones("amber") : "bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]"}`}>{event.event_type}</span><span className="min-w-0 flex-1 break-words text-[var(--color-text-secondary)]">{event.title}</span><span className="shrink-0 text-[var(--color-text-muted)]">{formatRelativeTime(event.created_at)}</span></div>)}</div> : <p className="text-xs text-[var(--color-text-muted)]">No pipeline events.</p>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {renameProject && <Overlay isOpen title={`Rename ${renameProject}`} onClose={() => setRenameProject(null)}><form className="space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); void rename(renameProject); }}><label htmlFor="rename-project" className="block text-sm font-medium">Project name</label><input id="rename-project" className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus required /><div className="flex justify-end gap-2"><button type="button" className="rounded border border-[var(--color-border)] px-4 py-2" onClick={() => setRenameProject(null)}>Cancel</button><button className="rounded bg-blue-600 px-4 py-2 text-white">Rename</button></div></form></Overlay>}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center" onClick={() => setShowCreate(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="new-project-title" className="my-auto max-h-full w-full max-w-md overflow-y-auto rounded-lg bg-[var(--color-surface)] p-4 shadow-xl sm:p-6" onClick={(e) => e.stopPropagation()}>
            <h3 id="new-project-title" className="mb-4 text-lg font-semibold">New Project</h3>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              className="border border-[var(--color-border)] p-2 rounded text-sm w-full mb-3"
              autoFocus
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button onClick={() => setShowCreate(false)} className="w-full rounded border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] sm:w-auto">Cancel</button>
              <button
                onClick={() => { create(); setShowCreate(false); }}
                disabled={!name}
                className="w-full rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50 sm:w-auto"
              >Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <Overlay isOpen={confirmDelete !== null} onClose={() => setConfirmDelete(null)}
        title="Delete Project" subtitle="This action cannot be undone.">
        {confirmDelete && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-text-secondary)]">
              Are you sure you want to permanently delete <strong>{confirmDelete}</strong>?
              All skills, observations, pipeline events, and settings for this project will be permanently removed.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button onClick={() => setConfirmDelete(null)} className="w-full rounded border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-hover)] sm:w-auto">Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} className="w-full rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 sm:w-auto">Delete</button>
            </div>
          </div>
        )}
      </Overlay>
    </div>
  );
}
