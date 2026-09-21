"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function ContextUploadSettings({ project }: { project: string }) {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("Not synced");
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([api.settings.get("context_auto_upload_enabled", project), api.settings.get("context_upload_last_sync", project)])
      .then(([setting, sync]) => {
        if (!active) return;
        setEnabled(setting.data.value === "true");
        if (sync.data.value) {
          try {
            const value = JSON.parse(sync.data.value);
            if (value.status === "synced" || value.status === "failed") {
              const date = typeof value.at === "string" ? new Date(value.at) : null;
              setStatus(`${value.status === "synced" ? "Last sync" : "Last sync failed"}${date && Number.isFinite(date.getTime()) ? `: ${date.toLocaleString()}` : ""}`);
            }
          } catch { setStatus("Sync status unavailable"); }
        }
        setReady(true);
      }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [project]);

  async function save(next: boolean) {
    setSaving(true);
    setError(false);
    try {
      await api.settings.set("context_auto_upload_enabled", String(next), project);
      setEnabled(next);
    } catch { setError(true); }
    finally { setSaving(false); }
  }

  return <section aria-label="Automatic Context upload" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
    <label className="flex items-center gap-3 text-sm font-medium text-[var(--color-text-primary)]">
      <input type="checkbox" checked={enabled} disabled={!ready || saving}
        onChange={(event) => void save(event.target.checked)} />
      Automatically upload external sessions for {project}
    </label>
    <p className="mt-2 text-sm text-[var(--color-text-muted)]">Off by default. Saves redacted visible user and completed assistant text when a session becomes idle. Turning off stops future uploads; existing Context is retained.</p>
    <p className="mt-2 text-xs text-[var(--color-text-muted)]" role="status">{status}</p>
    {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error-text)]">Unable to load or save Context upload settings.</p>}
  </section>;
}
