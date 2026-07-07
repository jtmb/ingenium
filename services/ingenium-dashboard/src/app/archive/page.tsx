"use client";
import { useState, useEffect } from "react";
import { api, Project } from "../../lib/api";

/**
 * Archive page — lists soft-deleted projects with restore and purge controls.
 * Archived projects auto-purge after the retention period (default 7 days).
 */
export default function ArchivePage() {
  const [archived, setArchived] = useState<Project[]>([]);

  const load = () => api.projects.listArchived().then((r) => setArchived(r.data ?? [])).catch(() => {});

  useEffect(() => { load(); }, []);

  const restore = async (name: string) => {
    await api.projects.restore(name);
    load();
  };

  const purge = async () => {
    await api.projects.purge();
    load();
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Archive</h1>
        <div className="flex gap-2">
          {archived.length > 0 && (
            <button onClick={purge} className="bg-red-600 text-white p-2 rounded hover:bg-red-700">
              Purge All Expired
            </button>
          )}
        </div>
      </div>

      {archived.length === 0 ? (
        <p className="text-gray-500">No archived projects.</p>
      ) : (
        <div className="space-y-2">
          {archived.map((p) => (
            <div key={p.id} className="bg-white p-4 rounded border flex items-center justify-between">
              <div>
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-gray-500 ml-3">
                  Archived {p.archived_at ? new Date(p.archived_at).toLocaleDateString() : "unknown"}
                </span>
              </div>
              <button onClick={() => restore(p.name)}
                      className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700">
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
