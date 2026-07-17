"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api } from "../../lib/api";

/**
 * ConfigPage — Dual-tab editor for opencode.json (project) and opencode.jsonc (global).
 *
 * The "Sync from disk" button reads the on-disk file back into the editor,
 * useful when OpenCode itself has modified the config. "Save" writes the
 * current editor content to both the DB and disk.
 */
export default function ConfigPage() {
  const project = useProject();
  const [tab, setTab] = useState<"project" | "global">("project");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Load config on tab or project change
  useEffect(() => {
    api.configs.get(tab, project)
      .then((r) => setContent(JSON.stringify(r.data?.content ? JSON.parse(r.data.content) : {}, null, 2)))
      .catch(() => setContent("{}"));
    setMessage(null);
  }, [tab, project]);

  const syncFromDisk = async () => {
    try {
      setMessage({ type: "success", text: "Syncing from disk..." });
      const r = await api.configs.sync(tab, project);
      const parsed = r.data?.content ? JSON.parse(r.data.content) : {};
      setContent(JSON.stringify(parsed, null, 2));
      setMessage({ type: "success", text: "Synced from disk." });
    } catch (e: any) {
      setMessage({ type: "error", text: `Sync failed: ${e.message}` });
    }
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api.configs.set(tab, content, project);
      setMessage({ type: "success", text: "Config saved." });
    } catch (e: any) {
      setMessage({ type: "error", text: `Save failed: ${e.message}` });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Config</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        <button
          onClick={() => setTab("project")}
          className={`px-4 py-2 text-sm font-medium rounded-t ${
            tab === "project" ? "bg-[var(--color-surface)] text-[var(--color-nav-text-active)] border border-b-[var(--color-border)] border-[var(--color-border)] -mb-px" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          Project Config
        </button>
        <button
          onClick={() => setTab("global")}
          className={`px-4 py-2 text-sm font-medium rounded-t ${
            tab === "global" ? "bg-[var(--color-surface)] text-[var(--color-nav-text-active)] border border-b-[var(--color-border)] border-[var(--color-border)] -mb-px" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          Global Config
        </button>
      </div>

      {/* Editor */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-4 space-y-3">
        <div className="text-sm text-[var(--color-text-muted)]">{tab === "project" ? "opencode.json" : "opencode.jsonc"}</div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full border border-[var(--color-border)] rounded p-3 font-mono text-sm leading-relaxed"
          rows={30}
          spellCheck={false}
          wrap="off"
        />
        <div className="flex gap-3">
          <button
            onClick={syncFromDisk}
            className="px-4 py-2 border border-[var(--color-border)] rounded text-sm hover:bg-[var(--color-surface-hover)]"
          >
            Sync from disk
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
        {message && (
          <div className={`text-sm px-3 py-2 rounded ${
            message.type === "success" ? "bg-[var(--color-success-bg)] text-green-700" : "bg-[var(--color-error-bg)] text-[var(--color-error-text)]"
          }`}>{message.text}</div>
        )}
      </div>
    </div>
  );
}
