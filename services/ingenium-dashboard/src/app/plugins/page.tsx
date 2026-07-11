"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect, useRef } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api, Plugin } from "../../lib/api";
import Overlay from "../components/Overlay";
import MarkdownViewer from "../components/MarkdownViewer";

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
        <p className="text-gray-500">Loading plugins...</p>
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
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Plugins</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition-colors"
        >
          {showCreate ? "Cancel" : "Add Plugin"}
        </button>
      </div>

      {showCreate && (
        <div className="bg-white p-4 rounded border hover:shadow-md transition-shadow">
          <div className="flex flex-row gap-2 items-end flex-wrap">
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="my-plugin"
                className="border rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">File Path</label>
              <input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="my-plugin.ts"
                className="border rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">File (.ts)</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".ts,.js"
                onChange={handleFileUpload}
                className="text-sm"
              />
            </div>
            <button
              onClick={handleCreate}
              className="bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!newName || !newPath}
            >
              Upload &amp; Create
            </button>
          </div>
        </div>
      )}

      {plugins.length === 0 ? (
        <p className="text-gray-500">
          No plugins registered. Click &quot;Add Plugin&quot; to upload one.
        </p>
      ) : (
        <div className="space-y-3">
          {plugins.map((p) =>
            editingId === p.id ? (
              <div key={p.id} className="bg-white p-4 rounded border space-y-3 hover:shadow-md transition-shadow">
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
                <div className="flex gap-2">
                  <button
                    onClick={() => handleUpdate(p.name)}
                    className="bg-blue-600 text-white py-2 px-4 rounded text-sm hover:bg-blue-700 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="bg-gray-200 text-gray-700 py-2 px-4 rounded text-sm hover:bg-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={p.id}
                className="bg-white p-4 rounded border hover:shadow-md transition-shadow flex flex-col gap-2 cursor-pointer"
                onClick={() => setSelectedPlugin(p)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{p.name}</span>
                    <span className="text-sm text-gray-500 ml-2">{p.file_path}</span>
                  </div>
                  <div className="flex gap-2">
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
                      className="bg-gray-100 text-gray-600 py-1 px-3 rounded text-sm hover:bg-gray-200 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggle(p); }}
                      className={`py-1 px-3 rounded text-sm transition-colors ${
                        p.enabled
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      {p.enabled ? "Enabled" : "Disabled"}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(p); }}
                      className="bg-red-600 text-white py-1 px-3 rounded text-sm hover:bg-red-700 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {p.source_content && (
                  <pre className="text-xs text-gray-400 font-mono truncate bg-gray-50 p-2 rounded">
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
            <div className="text-sm text-gray-600">
              <span className="font-semibold">Enabled:</span>{" "}
              <span className={selectedPlugin.enabled ? "text-green-600" : "text-red-600"}>
                {selectedPlugin.enabled ? "Yes" : "No"}
              </span>
            </div>
            {selectedPlugin.source_content && (
              <div>
                <div className="flex items-center gap-2 border-b border-gray-200 pb-2 mb-2">
                  <span className="px-3 py-1 text-sm rounded bg-gray-200 text-gray-400 cursor-not-allowed">Preview</span>
                  <span className="px-3 py-1 text-sm rounded bg-blue-600 text-white">Source</span>
                  <span className="text-xs text-gray-400 ml-auto">Source code — not markdown</span>
                </div>
                <pre className="bg-gray-50 p-4 rounded border overflow-x-auto text-sm font-mono whitespace-pre-wrap">
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
