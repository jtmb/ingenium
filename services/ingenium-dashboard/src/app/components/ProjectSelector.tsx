"use client";

import { useState, useEffect } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { api } from "../../lib/api";
import { useProject, persistProject } from "../../lib/ProjectContext";

export default function ProjectSelector() {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const activeProject = useProject();

  useEffect(() => {
    api.projects.list().then((r) => {
      setProjects(r.data.map((p) => ({ id: p.id, name: p.name })));
    }).catch(() => {});
  }, []);

  const selectProject = (name: string) => {
    setOpen(false);
    persistProject(name);
    const params = new URLSearchParams(searchParams.toString());
    params.set("project", name);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded px-3 py-1.5 bg-white flex items-center gap-2 min-w-[180px]"
      >
        <span className="truncate flex-1 text-left">{activeProject}</span>
        <span className="text-xs opacity-50">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded shadow-lg z-50 min-w-[200px] max-h-[300px] overflow-y-auto">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => selectProject(p.name)}
              className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${
                p.name === activeProject ? "bg-blue-50 text-blue-800 font-medium" : "text-gray-700"
              }`}
            >
              {p.name}
            </button>
          ))}
          {projects.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400">No projects</div>
          )}
        </div>
      )}
    </div>
  );
}
