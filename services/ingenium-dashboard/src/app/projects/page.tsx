"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect, useMemo } from "react";
import { api, Project } from "../../lib/api";
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
  const [view, setView] = useState<"active" | "archived">("active");
  const [details, setDetails] = useState<Record<string, any>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = () => {
    api.projects.list().then((r) => setProjects(r.data)).catch(() => {});
    api.projects.listArchived().then((r) => setArchived(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  // Fetch details for all active projects
  useEffect(() => {
    for (const p of projects) {
      api.projects.detail(p.name).then((r) => {
        setDetails((prev) => ({ ...prev, [p.name]: r.data }));
      }).catch(() => {});
    }
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
  const displayed = view === "active" ? activeProjects : archived;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Projects</h1>

      {/* View toggle + create */}
      <div className="flex gap-2 justify-between items-center">
        <div className="flex gap-2">
          <button onClick={() => setView("active")} className={`px-4 py-1.5 rounded text-sm font-medium ${view === "active" ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>Active</button>
          <button onClick={() => setView("archived")} className={`px-4 py-1.5 rounded text-sm font-medium ${view === "archived" ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>Archived</button>
        </div>
        {view === "active" && (
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" className="border border-gray-200 p-2 rounded text-sm w-48" />
            <button onClick={create} disabled={!name} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50">Create</button>
          </div>
        )}
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {displayed.map((p) => {
          const d = details[p.name];
          const synth = d?.latest_synthesis;
          const synthCount = synth ? formatRelative(synth) : "—";

          return (
            <div key={p.id} className="bg-white rounded border overflow-hidden">
              {/* Card header */}
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold">{p.name}</span>
                    {p.is_global && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium">GLOBAL</span>}
                    {p.archived_at && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded font-medium">ARCHIVED</span>}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">Created {formatRelative(p.created_at)}</div>
                </div>
                <div className="flex gap-2">
                  {view === "active" && (
                    <>
                      <button onClick={() => rename(p.name)} className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50 text-gray-600">Rename</button>
                      <button onClick={() => archive(p.name)} className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-red-50 text-red-600">Archive</button>
                    </>
                  )}
                  {view === "archived" && (
                    <div className="flex gap-2">
                      <button onClick={() => restore(p.name)} className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-green-50 text-green-600">Restore</button>
                      <button onClick={() => setConfirmDelete(p.name)} className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-red-50 text-red-600">Delete</button>
                    </div>
                  )}
                  <button onClick={() => setExpanded(expanded === p.name ? null : p.name)} className="text-xs px-3 py-1.5 bg-gray-50 hover:bg-gray-100 rounded text-gray-600 font-medium">{expanded === p.name ? "Collapse" : "Detail ▸"}</button>
                </div>
              </div>

              {/* Stats grid */}
              <div className="px-5 py-3 flex gap-6 text-sm">
                <div className="text-gray-500">
                  <span className="font-semibold text-gray-800">{d?.skills_count ?? "..."}</span> Skills
                </div>
                <div className="text-gray-500">
                  <span className="font-semibold text-gray-800">{d?.observation_stats?.total ?? "..."}</span> Observations
                  {d?.observation_stats?.pending > 0 && <span className="text-amber-500 ml-1">({d.observation_stats.pending} pending)</span>}
                </div>
                <div className="text-gray-500">
                  <span className="font-semibold text-gray-800">{d?.pipeline?.length ?? "..."}</span> Pipeline events
                </div>
                <div className="text-gray-500">
                  <span className="text-gray-400">Last synthesis:</span> <span className="font-medium text-gray-700">{synthCount}</span>
                </div>
                <div className="flex-1" />
                {p.path && <div className="text-xs text-gray-400 truncate max-w-[200px]" title={p.path}>{p.path}</div>}
              </div>

              {/* Expanded detail */}
              {expanded === p.name && d && (
                <div className="border-t border-gray-100 px-5 py-4 bg-gray-50">
                  <div className="grid grid-cols-2 gap-6">
                    {/* Recent skills */}
                    <div>
                      <h3 className="font-semibold text-sm mb-2 text-gray-700">Recent Skills</h3>
                      {d.recent_skills?.length > 0 ? (
                        <div className="space-y-1">
                          {d.recent_skills.slice(0, 5).map((s: any) => (
                            <div key={s.name} className="text-sm flex justify-between">
                              <span className="text-blue-600">{s.name}</span>
                              <span className="text-xs text-gray-400">{formatRelative(s.created_at)}</span>
                            </div>
                          ))}
                        </div>
                      ) : <p className="text-xs text-gray-400">No skills yet.</p>}
                    </div>

                    {/* Recent observations */}
                    <div>
                      <h3 className="font-semibold text-sm mb-2 text-gray-700">Recent Observations</h3>
                      {d.observation_stats?.recent?.length > 0 ? (
                        <div className="space-y-1">
                          {d.observation_stats.recent.slice(0, 5).map((o: any, i: number) => (
                            <div key={i} className="text-xs flex justify-between">
                              <span className="text-gray-600 truncate max-w-[200px]">{o.content?.substring(0, 80)}</span>
                              <span className="text-gray-400 ml-2">{formatRelative(o.created_at)}</span>
                            </div>
                          ))}
                        </div>
                      ) : <p className="text-xs text-gray-400">No observations yet.</p>}
                    </div>

                    {/* Pipeline events */}
                    <div className="col-span-2">
                      <h3 className="font-semibold text-sm mb-2 text-gray-700">Recent Pipeline Activity</h3>
                      {d.pipeline?.length > 0 ? (
                        <div className="space-y-1">
                          {d.pipeline.map((e: any) => (
                            <div key={e.created_at} className="text-xs flex gap-3">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                e.event_type?.startsWith("synthesis") ? "bg-emerald-100 text-emerald-700" :
                                e.event_type?.startsWith("trait") ? "bg-blue-100 text-blue-700" :
                                e.event_type?.startsWith("obs") ? "bg-amber-100 text-amber-700" :
                                "bg-gray-100 text-gray-600"
                              }`}>{e.event_type}</span>
                              <span className="text-gray-600 flex-1">{e.title}</span>
                              <span className="text-gray-400">{formatRelative(e.created_at)}</span>
                            </div>
                          ))}
                        </div>
                      ) : <p className="text-xs text-gray-400">No pipeline events.</p>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {displayed.length === 0 && <p className="text-gray-400 py-8 text-center">No {view} projects.</p>}
      </div>

      {/* Delete confirmation */}
      <Overlay isOpen={confirmDelete !== null} onClose={() => setConfirmDelete(null)}
        title="Delete Project" subtitle="This action cannot be undone.">
        {confirmDelete && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Are you sure you want to permanently delete <strong>{confirmDelete}</strong>?
              All skills, observations, pipeline events, and settings for this project will be permanently removed.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 border border-gray-200 rounded text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} className="px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700">Delete</button>
            </div>
          </div>
        )}
      </Overlay>
    </div>
  );
}
