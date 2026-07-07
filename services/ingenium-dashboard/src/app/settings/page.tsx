"use client";
import { useState, useEffect } from "react";
import { api } from "../../lib/api";

/**
 * Settings page — user-configurable preferences for the Ingenium dashboard.
 * Settings are stored per-project in the settings table (key-value).
 */
export default function SettingsPage() {
  const [retentionDays, setRetentionDays] = useState(7);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.settings.get("archive_retention_days").then((r) => {
      const val = parseInt(r.data.value, 10);
      if (!isNaN(val)) setRetentionDays(val);
    }).catch(() => {});
  }, []);

  const save = async (days: number) => {
    setRetentionDays(days);
    await api.settings.set("archive_retention_days", String(days));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Settings</h1>

      <div className="bg-white p-6 rounded border space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Archive retention (days)</label>
          <p className="text-xs text-gray-500 mb-2">
            Projects stay in the archive for this many days before being permanently deleted.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={365}
              value={retentionDays}
              onChange={(e) => save(parseInt(e.target.value, 10) || 7)}
              className="border p-2 rounded w-24"
            />
            <span className="text-sm text-gray-600">days</span>
            {saved && <span className="text-sm text-green-600">Saved!</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
