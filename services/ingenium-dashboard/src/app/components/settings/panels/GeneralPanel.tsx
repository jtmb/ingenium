"use client";
import { useState, useEffect } from "react";
import { api } from "../../../../lib/api";
import { useTheme } from "../../ThemeProvider";
import SettingRow from "../SettingRow";

export default function GeneralPanel() {
  const { theme, setTheme } = useTheme();
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [loadingRetention, setLoadingRetention] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Load archive retention
  useEffect(() => {
    api.settings.get("archive_retention_days", "global-default")
      .then((r) => {
        const val = parseInt(r.data.value, 10);
        if (!isNaN(val)) setRetentionDays(val);
      })
      .catch(() => {})
      .finally(() => setLoadingRetention(false));
  }, []);

  const saveRetention = async (days: number) => {
    setRetentionDays(days);
    setSaving(true);
    try {
      await api.settings.set("archive_retention_days", String(days), "global-default");
      setToast("Saved ✓");
    } catch (err: any) {
      setToast(`Error: ${err.message}`);
    }
    setSaving(false);
  };

  return (
    <div>
      <SettingRow label="Theme" description="Select light, dark, or system theme">
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as "system" | "light" | "dark")}
          className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </SettingRow>

      <SettingRow label="Archive retention" description="Days before archived projects are purged (1–365)">
        {loadingRetention ? (
          <span className="text-xs text-[var(--color-text-muted)] animate-pulse">Loading...</span>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={365}
              value={retentionDays ?? ""}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 1 && v <= 365) saveRetention(v);
              }}
              className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] w-20 text-[var(--color-text-primary)]"
              placeholder="7"
            />
            <span className="text-xs text-[var(--color-text-muted)]">days</span>
            {saving && <span className="text-xs text-[var(--color-text-muted)]">Saving...</span>}
          </div>
        )}
      </SettingRow>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50 text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
