"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect, useRef } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api, Plugin } from "../../lib/api";
import Overlay from "../components/Overlay";
import MarkdownViewer from "../components/MarkdownViewer";
import { badgeTones, BADGE_BASE } from "@/lib/badgeTones";

/**
 * Plugin management page.
 * Full CRUD: upload .ts plugin files, edit, enable/disable, delete.
 */
export default function PluginsPage() {
  const project = useProject();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [newContent, setNewContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPath, setEditPath] = useState("");
  const [editContent, setEditContent] = useState("");
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadPlugins = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.plugins.list(project);
      setPlugins(r.data);
    } catch (e: any) {
      setError(e.message ?? "Failed to load plugins");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPlugins(); }, [project]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setNewContent(ev.target?.result as string);
    reader.readAsText(file);
    if (!newPath) setNewPath(file.name);
  };

  const handleCreate = async () => {
    if (!newName || !newPath) return;
    try {
      await api.plugins.create(newName, newPath, newContent || undefined, project);
      setNewName("");
      setNewPath("");
      setNewContent("");
      setShowCreate(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadPlugins();
    } catch (e: any) {
      setError(e.message ?? "Failed to create plugin");
    }
  };

  const handleDelete = async (p: Plugin) => {
    if (!window.confirm(`Delete plugin "${p.name}"? This cannot be undone.`)) return;
    try {
      await api.plugins.delete(p.name, project);
      await loadPlugins();
    } catch (e: any) {
      setError(e.message ?? "Failed to delete plugin");
    }
  };

  const handleUpdate = async (name: string) => {
    try {
      await api.plugins.update(name, { file_path: editPath, source_content: editContent }, project);
      setEditingId(null);
      await loadPlugins();
    } catch (e: any) {
      setError(e.message ?? "Failed to update plugin");
    }
  };

  const toggle = async (p: Plugin) => {
    try {
      if (p.enabled) {
        await api.plugins.disable(p.name, project);
      } else {
        await api.plugins.enable(p.name, project);
      }
      setPlugins(plugins.map((x) => x.id === p.id ? { ...x, enabled: !x.enabled } : x));
    } catch (e: any) {
      setError(e.message ?? "Failed to toggle plugin");
    }
  };

  if (loading) {
    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-bold">Plugins</h1>
        <p className="text-[var(--color-text-muted)]">Loading plugins...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-bold">Plugins</h1>
        <p className="text-red-500">{error}</p>
        <button onClick={loadPlugins} className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition-colors">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 min-w-0">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="min-w-0 break-words text-3xl font-bold">Plugins</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="w-full rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 transition-colors sm:w-auto"
        >
          {showCreate ? "Cancel" : "Add Plugin"}
        </button>
      </div>

      {showCreate && (
        <div         className="bg-[var(--color-surface)] p-4 rounded border border-[var(--color-border)] hover:shadow-md transition-shadow">
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex min-w-0 flex-col">
              <label className="text-xs text-[var(--color-text-muted)] mb-1">Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="my-plugin"
                className="w-full min-w-0 rounded border px-3 py-2 text-sm"
              />
            </div>
            <div className="flex min-w-0 flex-col">
              <label className="text-xs text-[var(--color-text-muted)] mb-1">File Path</label>
              <input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="my-plugin.ts"
                className="w-full min-w-0 rounded border px-3 py-2 text-sm"
              />
            </div>
            <div className="flex min-w-0 flex-col">
              <label className="text-xs text-[var(--color-text-muted)] mb-1">File (.ts)</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".ts,.js"
                onChange={handleFileUpload}
                className="w-full min-w-0 text-sm"
              />
            </div>
            <button
              onClick={handleCreate}
                className="w-full rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              disabled={!newName || !newPath}
            >
              Upload &amp; Create
            </button>
          </div>
        </div>
      )}

      {plugins.length === 0 ? (
        <p className="text-[var(--color-text-muted)]">
          No plugins registered. Click &quot;Add Plugin&quot; to upload one.
        </p>
      ) : (
        <div className="space-y-3">
          {plugins.map((p) =>
            editingId === p.id ? (
                <div key={p.id} className="min-w-0 space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow">
                <input
                  value={editPath}
                  onChange={(e) => setEditPath(e.target.value)}
                  placeholder="plugin.ts"
                  className="w-full border rounded px-3 py-2 text-sm"
                />
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={10}
                  className="w-full border rounded px-3 py-2 text-sm font-mono"
                />
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    onClick={() => handleUpdate(p.name)}
                    className="w-full rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 transition-colors sm:w-auto"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="w-full rounded bg-gray-200 px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-gray-300 transition-colors sm:w-auto"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={p.id}
                className="flex min-w-0 cursor-pointer flex-col gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow"
                onClick={() => setSelectedPlugin(p)}
              >
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <span className="break-all font-medium">{p.name}</span>
                    <span className="ml-2 break-all text-sm text-[var(--color-text-muted)]">{p.file_path}</span>
                  </div>
                  <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        let content = p.source_content || "";
                        if (!content) {
                          try {
                            const res = await api.plugins.getSource(p.name, project);
                            content = res.data.source;
                          } catch { /* keep empty */ }
                        }
                        setEditingId(p.id);
                        setEditPath(p.file_path);
                        setEditContent(content);
                      }}
                       className="flex-1 rounded bg-[var(--color-surface-muted)] px-3 py-1 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors sm:flex-none"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggle(p); }}
                       className={`flex-1 rounded px-3 py-1 text-sm transition-colors sm:flex-none ${
                        p.enabled
                          ? "bg-[var(--color-success-bg)] text-green-700 hover:bg-[var(--color-surface-hover)]"
                          : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
                      }`}
                    >
                      {p.enabled ? "Enabled" : "Disabled"}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(p); }}
                       className="flex-1 rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700 transition-colors sm:flex-none"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {p.source_content && (
                  <pre className="break-all whitespace-pre-wrap rounded bg-[var(--color-surface-muted)] p-2 text-xs font-mono text-[var(--color-text-muted)]">
                    {p.source_content.slice(0, 120)}
                    {p.source_content.length > 120 ? "..." : ""}
                  </pre>
                )}
              </div>
            )
          )}
        </div>
      )}
      <Overlay
        isOpen={selectedPlugin !== null}
        onClose={() => setSelectedPlugin(null)}
        title={selectedPlugin?.name ?? ""}
        subtitle={selectedPlugin?.file_path}
      >
        {selectedPlugin && (
          <div className="space-y-4">
            <div className="text-sm text-[var(--color-text-secondary)]">
              <span className="font-semibold">Enabled:</span>{" "}
              <span className={selectedPlugin.enabled ? "text-[var(--color-success-text)]" : "text-[var(--color-error-text)]"}>
                {selectedPlugin.enabled ? "Yes" : "No"}
              </span>
            </div>
            {selectedPlugin.source_content && (
              <div>
                <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-2 mb-2">
                  <span className="px-3 py-1 text-sm rounded bg-gray-200 text-[var(--color-text-muted)] cursor-not-allowed">Preview</span>
                  <span className="px-3 py-1 text-sm rounded bg-blue-600 text-white">Source</span>
                  <span className="text-xs text-[var(--color-text-muted)] ml-auto">Source code — not markdown</span>
                </div>
               <pre className="overflow-x-auto break-all rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 text-sm font-mono whitespace-pre-wrap">
                  {selectedPlugin.source_content}
                </pre>
              </div>
            )}
          </div>
        )}
      </Overlay>
    </div>
  );
}
