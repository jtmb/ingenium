"use client";
import { useState, useEffect } from "react";
import { api } from "../../../../lib/api";
import { useGlobalProject } from "../../../../lib/ProjectContext";
import { useTheme } from "../../ThemeProvider";
import SettingRow from "../SettingRow";
import Select from "../../Select";

/**
 * General settings panel — theme selection and archive retention config.
 *
 * Reads/writes settings through the API's settings endpoints, targeting the
 * global-default project since these are instance-wide preferences.
 */
export default function GeneralPanel() {
  const { theme, setTheme } = useTheme();
  const { project: globalProject, loading: globalProjectLoading, error: globalProjectError } = useGlobalProject();
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [loadingRetention, setLoadingRetention] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [retentionError, setRetentionError] = useState("");

  // Auto-dismiss toast notification after 3s.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (globalProjectLoading) return;
    if (!globalProject) {
      setLoadingRetention(false);
      return;
    }

    setLoadingRetention(true);
    api.settings.get("archive_retention_days", globalProject)
      .then((r) => {
        const val = parseInt(r.data.value, 10);
        if (!isNaN(val)) setRetentionDays(val);
      })
      .catch((error: unknown) => {
        setRetentionError(error instanceof Error ? error.message : "Unable to load archive retention");
      })
      .finally(() => setLoadingRetention(false));
  }, [globalProject, globalProjectLoading]);

  const saveRetention = async (days: number) => {
    if (!globalProject) {
      setRetentionError("Archive retention is unavailable until the global project is resolved.");
      return;
    }
    const previous = retentionDays;
    setRetentionError("");
    setRetentionDays(days);
    setSaving(true);
    try {
      await api.settings.set("archive_retention_days", String(days), globalProject);
      setToast("Saved ✓");
    } catch (error: unknown) {
      setRetentionDays(previous);
      setRetentionError(error instanceof Error ? error.message : "Archive retention could not be saved");
    }
    setSaving(false);
  };

  return (
    <div>
      <SettingRow label="Theme" description="Select light, dark, or system theme" controlId="general-theme">
        <Select
          id="general-theme"
          value={theme}
          onChange={(e) => setTheme(e.target.value as "system" | "light" | "dark")}
          className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </Select>
      </SettingRow>

      <SettingRow label="Archive retention" description="Days before archived projects are purged (1–365)">
        {globalProjectLoading || loadingRetention ? (
          <span className="text-xs text-[var(--color-text-muted)] animate-pulse">Loading...</span>
        ) : !globalProject ? (
          <span className="text-xs text-[var(--color-error-text)]">
            {globalProjectError ? "Global project could not be resolved." : "No active global project is configured."}
          </span>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={365}
              value={retentionDays ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                const v = Number(raw);
                if (!raw || !Number.isInteger(v) || v < 1 || v > 365) {
                  setRetentionError("Enter a whole number from 1 to 365.");
                  return;
                }
                setRetentionError("");
                void saveRetention(v);
              }}
              aria-invalid={Boolean(retentionError)}
              aria-describedby={retentionError ? "archive-retention-error" : undefined}
              className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] w-20 text-[var(--color-text-primary)]"
              placeholder="7"
            />
            <span className="text-xs text-[var(--color-text-muted)]">days</span>
            {saving && <span className="text-xs text-[var(--color-text-muted)]">Saving...</span>}
          </div>
        )}
      </SettingRow>

      {retentionError && (
        <p id="archive-retention-error" role="alert" className="px-6 -mt-2 mb-3 text-xs text-[var(--color-error-text)]">
          {retentionError}
        </p>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50 text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
