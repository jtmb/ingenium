"use client";
import { useState, useEffect } from "react";
import { api, Project } from "../../lib/api";

/**
 * Projects management page.
 * Lists existing projects and allows creating new ones via a simple name-only form.
 */
export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");

  useEffect(() => { api.projects.list().then((r) => setProjects(r.data)).catch(() => {}); }, []);

  /** Creates a new project and prepends it to the local list. */
  const create = async () => {
    if (!name) return;
    const res = await api.projects.create(name);
    setProjects([res.data, ...projects]);
    setName("");
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Projects</h1>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" className="border p-2 rounded flex-1" />
        <button onClick={create} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Create</button>
      </div>
      <div className="space-y-2">
        {projects.map((p) => (
          <div key={p.id} className="bg-white p-4 rounded border">
            <span className="font-medium">{p.name}</span>
            <span className="text-sm text-gray-500 ml-4">{p.path}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
