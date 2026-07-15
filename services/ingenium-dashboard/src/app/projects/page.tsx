"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect, useMemo } from "react";
import { api, Project } from "../../lib/api";
import { badgeTones } from "../../lib/badgeTones";
import Overlay from "../components/Overlay";

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.abs(Math.floor(diff / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Projects</h1>
        <button onClick={() => setShowCreate(true)} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">+ New Project</button>
      </div>

      {/* View toggle + search */}
      <div className="flex gap-2 justify-between items-center">
        <div className="flex gap-2 items-center">
          <button onClick={() => setView("active")} className={`px-3 py-1 rounded text-sm font-medium ${view === "active" ? "bg-blue-600 text-white" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"}`}>Active</button>
          <button onClick={() => setView("archived")} className={`px-3 py-1 rounded text-sm font-medium ${view === "archived" ? "bg-blue-600 text-white" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"}`}>Archived</button>
        </div>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search projects..."
          className="border border-[var(--color-border)] p-2 rounded text-sm w-64"
        />
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {displayed.map((p) => {
          const d = details[p.name];
          const synth = d?.latest_synthesis;
          const synthCount = synth ? formatRelative(synth) : "—";

          return (
            <div key={p.id} onClick={() => setExpanded(expanded === p.name ? null : p.name)} className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] overflow-hidden hover:shadow-md transition-shadow cursor-pointer">
              {/* Card header */}
              <div className="px-5 py-4 border-b border-[var(--color-border-muted)] flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold">{p.name}</span>
                    {!!p.is_global && <span className={`text-xs ${badgeTones('blue')} px-2 py-0.5 rounded font-medium`}>GLOBAL</span>}
                    {p.archived_at && <span className={`text-xs ${badgeTones('error')} px-2 py-0.5 rounded font-medium`}>ARCHIVED</span>}
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-0.5">Created {formatRelative(p.created_at)}</div>
                </div>
                <div className="flex gap-2">
                  {view === "active" && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); rename(p.name); }} className="text-xs px-3 py-1.5 border border-[var(--color-border)] rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]">Rename</button>
                      <button onClick={(e) => { e.stopPropagation(); archive(p.name); }} className="text-xs px-3 py-1.5 border border-[var(--color-border)] rounded hover:bg-[var(--color-error-bg)] text-[var(--color-error-text)]">Archive</button>
                    </>
                  )}
                  {view === "archived" && (
                    <div className="flex gap-2">
                      <button onClick={(e) => { e.stopPropagation(); restore(p.name); }} className="text-xs px-3 py-1.5 border border-[var(--color-border)] rounded hover:bg-[var(--color-success-bg)] text-[var(--color-success-text)]">Restore</button>
                      <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(p.name); }} className="text-xs px-3 py-1.5 border border-[var(--color-border)] rounded hover:bg-[var(--color-error-bg)] text-[var(--color-error-text)]">Delete</button>
                    </div>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); setExpanded(expanded === p.name ? null : p.name); }} className="text-xs px-3 py-1.5 bg-[var(--color-surface-muted)] hover:bg-[var(--color-surface-hover)] rounded text-[var(--color-text-secondary)] font-medium">{expanded === p.name ? "Collapse" : "Detail ▸"}</button>
                </div>
              </div>

              {/* Stats grid */}
              <div className="px-5 py-3 flex gap-6 text-sm">
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
                <div className="flex-1" />
                {p.path && <div className="text-xs text-[var(--color-text-muted)] truncate max-w-[200px]" title={p.path}>{p.path}</div>}
              </div>

              {/* Expanded detail */}
              {expanded === p.name && d && (
                <div className="border-t border-[var(--color-border-muted)] px-5 py-4 bg-[var(--color-surface-muted)]">
                  <div className="grid grid-cols-2 gap-6">
                    {/* Recent skills */}
                    <div>
                      <h3 className="font-semibold text-sm mb-2 text-[var(--color-text-primary)]">Recent Skills</h3>
                      {d.recent_skills?.length > 0 ? (
                        <div className="space-y-1">
                          {d.recent_skills.slice(0, 5).map((s: any) => (
                            <div key={s.name} className="text-sm flex justify-between">
                              <span className="text-[var(--color-text-link)]">{s.name}</span>
                              <span className="text-xs text-[var(--color-text-muted)]">{formatRelative(s.created_at)}</span>
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
                            <div key={i} className="text-xs flex justify-between">
                              <span className="text-[var(--color-text-secondary)] truncate max-w-[200px]">{o.content?.substring(0, 80)}</span>
                              <span className="text-[var(--color-text-muted)] ml-2">{formatRelative(o.created_at)}</span>
                            </div>
                          ))}
                        </div>
                      ) : <p className="text-xs text-[var(--color-text-muted)]">No observations yet.</p>}
                    </div>

                    {/* Pipeline events */}
                    <div className="col-span-2">
                      <h3 className="font-semibold text-sm mb-2 text-[var(--color-text-primary)]">Recent Pipeline Activity</h3>
                      {d.pipeline?.length > 0 ? (
                        <div className="space-y-1">
                          {d.pipeline.map((e: any) => (
                            <div key={e.created_at} className="text-xs flex gap-3">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                e.event_type?.startsWith("synthesis") ? badgeTones('emerald') :
                                e.event_type?.startsWith("trait") ? badgeTones('blue') :
                                e.event_type?.startsWith("obs") ? badgeTones('amber') :
                                "bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]"
                              }`}>{e.event_type}</span>
                              <span className="text-[var(--color-text-secondary)] flex-1">{e.title}</span>
                              <span className="text-[var(--color-text-muted)]">{formatRelative(e.created_at)}</span>
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setShowCreate(false)}>
          <div className="bg-[var(--color-surface)] p-6 rounded-lg shadow-xl w-96" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">New Project</h3>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              className="border border-[var(--color-border)] p-2 rounded text-sm w-full mb-3"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)]">Cancel</button>
              <button
                onClick={() => { create(); setShowCreate(false); }}
                disabled={!name}
                className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
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
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 border border-[var(--color-border)] rounded text-sm hover:bg-[var(--color-surface-hover)]">Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} className="px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700">Delete</button>
            </div>
          </div>
        )}
      </Overlay>
    </div>
  );
}
