"use client";
import { useState, useEffect } from "react";
import { api, Project } from "../../lib/api";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [archived, setArchived] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [view, setView] = useState<"active" | "archived">("active");

  const load = () => {
    api.projects.list().then((r) => setProjects(r.data)).catch(() => {});
    api.projects.listArchived().then((r) => setArchived(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

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

  const displayed = view === "active" ? projects : archived;

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Projects</h1>
      
      {/* View toggle */}
      <div className="flex gap-2 border-b pb-2">
        <button onClick={() => setView("active")} className={`px-4 py-1 rounded ${view === "active" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>Active</button>
        <button onClick={() => setView("archived")} className={`px-4 py-1 rounded ${view === "archived" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>Archived</button>
      </div>

      {/* Create bar (active only) */}
      {view === "active" && (
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" className="border p-2 rounded flex-1" />
          <button onClick={create} className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700">Create</button>
        </div>
      )}

      {/* Project cards */}
      <div className="space-y-2">
        {displayed.map((p) => (
          <div key={p.id} className="bg-white p-4 rounded border flex items-center justify-between">
            <div>
              <span className="font-medium">{p.name}</span>
              <span className="text-sm text-gray-500 ml-4">{p.path}</span>
              {p.archived_at && <span className="text-xs text-red-500 ml-2">Archived: {new Date(p.archived_at).toLocaleDateString()}</span>}
            </div>
            <div className="flex gap-2">
              {view === "active" && (
                <>
                  <button onClick={() => rename(p.name)} className="text-xs px-2 py-1 border rounded hover:bg-gray-100">Rename</button>
                  <button onClick={() => archive(p.name)} className="text-xs px-2 py-1 border rounded hover:bg-red-50 text-red-600">Archive</button>
                </>
              )}
              {view === "archived" && (
                <button onClick={() => restore(p.name)} className="text-xs px-2 py-1 border rounded hover:bg-green-50 text-green-600">Restore</button>
              )}
            </div>
          </div>
        ))}
        {displayed.length === 0 && <p className="text-gray-400">No {view} projects.</p>}
      </div>
    </div>
  );
}