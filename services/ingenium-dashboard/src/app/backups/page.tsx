"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api, Backup, BackupSchedule } from "../../lib/api";
import { badgeTones, BADGE_BASE } from "@/lib/badgeTones";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Format raw bytes to a human-readable string (e.g. "1.5 MB", "234 KB"). */
function humanSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const s = (bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0);
  return `${s} ${units[i]}`;
}

/** Format an ISO string to a locale-friendly datetime. */
function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

/** Skeleton row for the loading state. */
function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b border-[var(--color-border-muted)]">
      <td className="px-4 py-3">
        <div className="h-4 bg-[var(--color-surface-muted)] rounded w-48" />
      </td>
      <td className="px-4 py-3">
        <div className="h-5 bg-[var(--color-surface-muted)] rounded w-16" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 bg-[var(--color-surface-muted)] rounded w-16" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 bg-[var(--color-surface-muted)] rounded w-32" />
      </td>
      <td className="px-4 py-3">
        <div className="h-5 bg-[var(--color-surface-muted)] rounded w-20" />
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <div className="h-5 bg-[var(--color-surface-muted)] rounded w-16" />
          <div className="h-5 bg-[var(--color-surface-muted)] rounded w-16" />
        </div>
      </td>
    </tr>
  );
}

/** Type badge with colour-coded hue. */
function TypeBadge({ type }: { type: Backup["type"] }) {
  const hues: Record<string, string> = {
    manual: badgeTones("blue"),
    hourly: badgeTones("purple"),
    daily: badgeTones("teal"),
  };
  const labels: Record<string, string> = {
    manual: "Manual",
    hourly: "Hourly",
    daily: "Daily",
  };
  return (
    <span className={`${BADGE_BASE} ${hues[type] ?? badgeTones("gray")}`}>
      {labels[type] ?? type}
    </span>
  );
}

/** Status badge for the table. */
function StatusBadge({ status }: { status: Backup["status"] }) {
  const colors: Record<string, string> = {
    completed: badgeTones("success"),
    in_progress: badgeTones("blue"),
    failed: badgeTones("error"),
  };
  const labels: Record<string, string> = {
    completed: "Completed",
    in_progress: "In Progress",
    failed: "Failed",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {status === "in_progress" && (
        <svg className="animate-spin w-3 h-3 text-[var(--color-accent)]" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {status === "failed" && (
        <span className="w-2 h-2 rounded-full bg-[var(--color-error-text)]" />
      )}
      {status === "completed" && (
        <span className="w-2 h-2 rounded-full bg-[var(--color-success-text)]" />
      )}
      <span className={colors[status] ?? badgeTones("gray")}>{labels[status] ?? status}</span>
    </span>
  );
}

/** Schedule section card — shows hourly/daily toggle and next-run countdown. */
function ScheduleCard({ project }: { project: string }) {
  const [schedule, setSchedule] = useState<BackupSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.backups.schedule.get(project);
      setSchedule(res.data);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load schedule");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  const handleToggle = useCallback(
    async (type: "hourly" | "daily", enabled: boolean) => {
      try {
        const payload = type === "hourly"
          ? { hourly: { enabled } }
          : { daily: { enabled } };
        const res = await api.backups.schedule.set(payload, project);
        setSchedule(res.data);
      } catch (e: any) {
        setError(e?.message ?? "Failed to update schedule");
      }
    },
    [project],
  );

  return (
    <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-5 hover:shadow-md transition-shadow">
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">Backup Schedule</h2>

      {loading && (
        <div className="space-y-3 animate-pulse">
          <div className="h-10 bg-[var(--color-surface-muted)] rounded" />
          <div className="h-10 bg-[var(--color-surface-muted)] rounded" />
        </div>
      )}

      {error && (
        <div className="text-[var(--color-error-text)] text-xs bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded p-3 mb-3">
          {error}
          <button onClick={fetchSchedule} className="ml-2 underline hover:no-underline">Retry</button>
        </div>
      )}

      {!loading && schedule && (
        <div className="space-y-3">
          {/* Hourly */}
          <div className="flex items-center justify-between py-2 px-3 bg-[var(--color-surface-muted)] rounded">
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={schedule.hourly.enabled}
                  onChange={(e) => handleToggle("hourly", e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--color-accent)]" />
              </label>
              <div>
                <p className="text-sm font-medium text-[var(--color-text-primary)]">Hourly</p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Every hour · keep {schedule.hourly.retention}
                </p>
              </div>
            </div>
          </div>

          {/* Daily */}
          <div className="flex items-center justify-between py-2 px-3 bg-[var(--color-surface-muted)] rounded">
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={schedule.daily.enabled}
                  onChange={(e) => handleToggle("daily", e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--color-accent)]" />
              </label>
              <div>
                <p className="text-sm font-medium text-[var(--color-text-primary)]">Daily</p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Every day · keep {schedule.daily.retention}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && !schedule && !error && (
        <p className="text-xs text-[var(--color-text-muted)] italic">Schedule not configured.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Backups Page                                                */
/* ------------------------------------------------------------------ */

/**
 * BackupsPage — View and manage database backups.
 *
 * States:
 *   - Loading: skeleton animation in the table
 *   - Empty: "No backups yet. Create your first backup."
 *   - Error: error banner with retry button
 *   - Populated: table of backups with download/delete actions
 *
 * A ScheduleCard below the table shows hourly/daily schedule status
 * with toggle switches and next-run countdown.
 */
export default function BackupsPage() {
  const project = useProject();

  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchBackups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.backups.list(project);
      setBackups(res.data ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load backups");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    fetchBackups();
  }, [fetchBackups]);

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      await api.backups.create(project);
      await fetchBackups();
    } catch (e: any) {
      setCreateError(e?.message ?? "Failed to create backup");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (backup: Backup) => {
    if (!confirm(`Delete backup "${backup.filename}"? This cannot be undone.`)) return;
    try {
      await api.backups.delete(backup.id, project);
      setBackups((prev) => prev.filter((b) => b.id !== backup.id));
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete backup");
    }
  };

  const handleDownload = (backup: Backup) => {
    const url = api.backups.download(backup.id, project);
    // Open the download URL in a new tab (or trigger a download via anchor)
    const a = document.createElement("a");
    a.href = url;
    a.download = backup.filename;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">Backups</h1>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="bg-blue-600 text-white py-2 px-4 rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {creating ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Creating...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Backup Now
            </>
          )}
        </button>
      </div>

      {createError && (
        <div className="text-[var(--color-error-text)] text-sm bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded p-3">
          {createError}
        </div>
      )}

      {error && (
        <div className="text-[var(--color-error-text)] text-sm bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded p-3 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={fetchBackups}
            className="text-sm underline hover:no-underline text-[var(--color-text-link)]"
          >
            Retry
          </button>
        </div>
      )}

      {/* Backups table */}
      <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden hover:shadow-md transition-shadow">
        {loading ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                <th className="px-4 py-3 font-medium">Filename</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Size</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </tbody>
          </table>
        ) : backups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <svg className="w-12 h-12 text-[var(--color-text-muted)] mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">No backups yet</p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">Create your first backup.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                  <th className="px-4 py-3 font-medium">Filename</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Size</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr
                    key={backup.id}
                    className="border-b border-[var(--color-border-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-primary)]">
                      {backup.filename}
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={backup.type} />
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)] whitespace-nowrap">
                      {humanSize(backup.size)}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)] text-xs whitespace-nowrap">
                      {fmtDate(backup.created_at)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={backup.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDownload(backup)}
                          disabled={backup.status !== "completed"}
                          title={backup.status === "completed" ? "Download backup" : "Backup not ready"}
                          className="flex items-center gap-1 text-xs text-[var(--color-text-link)] hover:text-[var(--color-text-link-hover)] disabled:text-[var(--color-text-muted)] disabled:cursor-not-allowed"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Download
                        </button>
                        <button
                          onClick={() => handleDelete(backup)}
                          className="flex items-center gap-1 text-xs text-[var(--color-error-text)] hover:text-red-800 dark:hover:text-red-300"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Schedule section */}
      <ScheduleCard project={project} />
    </div>
  );
}
