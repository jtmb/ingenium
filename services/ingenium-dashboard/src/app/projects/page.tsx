"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect, useMemo } from "react";
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
export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [archived, setArchived] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<"active" | "archived">("active");
  const [details, setDetails] = useState<Record<string, any>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const activeProject = useProject();
  const [activeName, setActiveName] = useState(activeProject);

  const load = () => {
    api.projects.list().then((r) => setProjects(r.data)).catch(() => {});
    api.projects.listArchived().then((r) => setArchived(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  // Fetch details for all active projects in parallel
  useEffect(() => {
    if (projects.length === 0) return;
    Promise.all(projects.map((p) =>
      api.projects.detail(p.name).then((r) => ({ name: p.name, data: r.data }))
    )).then((results) => {
      const batch: Record<string, any> = {};
      for (const r of results) batch[r.name] = r.data;
      setDetails((prev) => ({ ...prev, ...batch }));
    }).catch(() => {});
  }, [projects]);

  const create = async () => {
    if (!name) return;
    await api.projects.create(name);
    setName("");
    load();
  };

  const archive = async (n: string) => { await api.projects.archive(n); load(); };
  const restore = async (n: string) => { await api.projects.restore(n); load(); };
  const rename = async (oldName: string) => {
    const newName = prompt("New name:", oldName);
    if (newName && newName !== oldName) {
      await api.projects.update(oldName, newName);
      load();
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await api.projects.purgeOne(name);
      setConfirmDelete(null);
      load();
    } catch {
      alert("Failed to delete project");
      setConfirmDelete(null);
    }
  };

  const activeProjects = projects.filter(p => !p.archived_at);
  const displayed = (view === "active" ? activeProjects : archived)
    .filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()));

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

      {/* Cards */}
      <div className="space-y-3">
        {displayed.map((p) => {
          const d = details[p.name];
          const synth = d?.latest_synthesis;
          const synthCount = synth ? formatRelativeTime(synth) : "—";

          return (
            <div key={p.id} onClick={() => setExpanded(expanded === p.name ? null : p.name)} className="min-w-0 cursor-pointer overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:shadow-md transition-shadow">
              {/* Card header */}
              <div className="flex flex-col items-start gap-3 border-b border-[var(--color-border-muted)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all text-lg font-semibold">{p.name}</span>
                    {!!p.is_global && <span className={`text-xs ${badgeTones('blue')} px-2 py-0.5 rounded font-medium`}>GLOBAL</span>}
                    {!p.archived_at && p.name === activeName && (
                      <span className={`text-xs ${badgeTones('green')} px-2 py-0.5 rounded font-medium`}>ACTIVE</span>
                    )}
                    {p.archived_at && <span className={`text-xs ${badgeTones('error')} px-2 py-0.5 rounded font-medium`}>ARCHIVED</span>}
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-0.5">Created {formatRelativeTime(p.created_at)}</div>
                </div>
                <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
                  {view === "active" && (
                    <>
                      {p.name !== activeName && (
                        <button
                          onClick={(e) => { e.stopPropagation(); persistProject(p.name); setActiveName(p.name); }}
                          className="flex-1 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] sm:flex-none"
                        >Set Active</button>
                      )}
                        <button onClick={(e) => { e.stopPropagation(); rename(p.name); }} className="flex-1 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] sm:flex-none">Rename</button>
                        <button onClick={(e) => { e.stopPropagation(); archive(p.name); }} className="flex-1 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-error-text)] hover:bg-[var(--color-error-bg)] sm:flex-none">Archive</button>
                    </>
                  )}
                  {view === "archived" && (
                    <div className="flex w-full gap-2 sm:w-auto">
                      <button onClick={(e) => { e.stopPropagation(); restore(p.name); }} className="flex-1 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-success-text)] hover:bg-[var(--color-success-bg)] sm:flex-none">Restore</button>
                      <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(p.name); }} className="flex-1 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-error-text)] hover:bg-[var(--color-error-bg)] sm:flex-none">Delete</button>
                    </div>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); setExpanded(expanded === p.name ? null : p.name); }} className="flex-1 rounded bg-[var(--color-surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] sm:flex-none">{expanded === p.name ? "Collapse" : "Detail ▸"}</button>
                </div>
              </div>

              {/* Stats grid */}
              <div className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
                <div className="text-[var(--color-text-muted)]">
                  <span className="font-semibold text-[var(--color-text-primary)]">{d?.skills_count ?? "..."}</span> Skills
                </div>
                <div className="text-[var(--color-text-muted)]">
                  <span className="font-semibold text-[var(--color-text-primary)]">{d?.observation_stats?.total ?? "..."}</span> Observations
                  {d?.observation_stats?.pending > 0 && <span className="text-amber-500 ml-1">({d.observation_stats.pending} pending)</span>}
                </div>
                <div className="text-[var(--color-text-muted)]">
                  <span className="font-semibold text-[var(--color-text-primary)]">{d?.pipeline?.length ?? "..."}</span> Pipeline events
                </div>
                <div className="text-[var(--color-text-muted)]">
                  <span className="text-[var(--color-text-muted)]">Last synthesis:</span> <span className="font-medium text-[var(--color-text-primary)]">{synthCount}</span>
                </div>
                <div className="hidden flex-1 sm:block" />
                {p.path && <div className="max-w-full break-all text-xs text-[var(--color-text-muted)] sm:max-w-[200px] sm:truncate" title={p.path}>{p.path}</div>}
              </div>

              {/* Expanded detail */}
              {expanded === p.name && d && (
                <div className="border-t border-[var(--color-border-muted)] px-5 py-4 bg-[var(--color-surface-muted)]">
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    {/* Recent skills */}
                    <div>
                      <h3 className="font-semibold text-sm mb-2 text-[var(--color-text-primary)]">Recent Skills</h3>
                      {d.recent_skills?.length > 0 ? (
                        <div className="space-y-1">
                          {d.recent_skills.slice(0, 5).map((s: any) => (
                            <div key={s.name} className="flex min-w-0 justify-between gap-2 text-sm">
                              <span className="min-w-0 break-all text-[var(--color-text-link)]">{s.name}</span>
                              <span className="shrink-0 text-xs text-[var(--color-text-muted)]">{formatRelativeTime(s.created_at)}</span>
                            </div>
                          ))}
                        </div>
                      ) : <p className="text-xs text-[var(--color-text-muted)]">No skills yet.</p>}
                    </div>

                    {/* Recent observations */}
                    <div>
                      <h3 className="font-semibold text-sm mb-2 text-[var(--color-text-primary)]">Recent Observations</h3>
                      {d.observation_stats?.recent?.length > 0 ? (
                        <div className="space-y-1">
                          {d.observation_stats.recent.slice(0, 5).map((o: any, i: number) => (
                            <div key={i} className="flex min-w-0 justify-between gap-2 text-xs">
                              <span className="min-w-0 break-words text-[var(--color-text-secondary)] sm:max-w-[200px] sm:truncate">{o.content?.substring(0, 80)}</span>
                              <span className="ml-2 shrink-0 text-[var(--color-text-muted)]">{formatRelativeTime(o.created_at)}</span>
                            </div>
                          ))}
                        </div>
                      ) : <p className="text-xs text-[var(--color-text-muted)]">No observations yet.</p>}
                    </div>

                    {/* Pipeline events */}
                    <div className="sm:col-span-2">
                      <h3 className="font-semibold text-sm mb-2 text-[var(--color-text-primary)]">Recent Pipeline Activity</h3>
                      {d.pipeline?.length > 0 ? (
                        <div className="space-y-1">
                          {d.pipeline.map((e: any) => (
                            <div key={e.created_at} className="flex min-w-0 gap-3 text-xs">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                e.event_type?.startsWith("synthesis") ? badgeTones('emerald') :
                                e.event_type?.startsWith("trait") ? badgeTones('blue') :
                                e.event_type?.startsWith("obs") ? badgeTones('amber') :
                                "bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]"
                              }`}>{e.event_type}</span>
                              <span className="min-w-0 flex-1 break-words text-[var(--color-text-secondary)]">{e.title}</span>
                              <span className="shrink-0 text-[var(--color-text-muted)]">{formatRelativeTime(e.created_at)}</span>
                            </div>
                          ))}
                        </div>
                      ) : <p className="text-xs text-[var(--color-text-muted)]">No pipeline events.</p>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {displayed.length === 0 && <p className="text-[var(--color-text-muted)] py-8 text-center">No {view} projects.</p>}
      </div>

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
