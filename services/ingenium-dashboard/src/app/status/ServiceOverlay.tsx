"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { getApiBase } from "@/lib/api";
import { formatUptime } from "@/lib/time";

const API_URL = getApiBase();

interface ServiceDetail {
  name: string;
  state: string;
  pid?: number;
  port?: number;
  uptime: number;
  exitstatus?: number;
  spawnerr?: string;
  stop?: number;
  description: string;
}

interface ServiceLogs {
  name: string;
  log: string;
  offset: number;
  more: boolean;
}

interface FolderInfo {
  folder: string;
  state: string;
  headersSynced: number;
  headersTotal: number;
  bodiesCached: number;
  bodiesWindow: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

interface AccountInfo {
  accountId: string;
  email: string;
  folders: FolderInfo[];
}

interface AppEngine {
  running: boolean;
  heartbeatAt: string | null;
  accounts: AccountInfo[];
}

interface AppStats {
  totalObservations?: number;
  pendingCount?: number;
  processedCount?: number;
  traitCount?: number;
  spaces?: number;
  pages?: number;
  drafts?: number;
  total?: number;
  byColumn?: Record<string, number>;
}

interface AppDetail {
  scope?: { kind: "installation" } | { kind: "project"; projectId: string; projectName: string };
  lastProcessedAt?: string | null;
  name: string;
  state: string;
  description: string;
  detail?: string;
  intervalMs?: number;
  lastRunAt?: string | null;
  nextEstimate?: string | null;
  stats?: AppStats | null;
  engine?: AppEngine | null;
}

interface ServiceOverlayProps {
  project?: string;
  name: string;
  type: "service" | "application";
  onClose: () => void;
}

/**
 * Maps process and application states to CSS classes for the state badge.
 * Semantic: the error category is used for "error", "unhealthy", and
 * "stopped"/"disabled" states because each requires attention.
 */
function stateBadgeStyle(state: string) {
  switch (state) {
    case "running":
    case "healthy":
      return {
        bg: "bg-[var(--color-success-bg)]",
        text: "text-[var(--color-success-text)]",
        dot: "bg-[var(--color-success-text)]",
      };
    case "starting":
    case "degraded":
      return {
        bg: "bg-[var(--color-warning-bg)]",
        text: "text-[var(--color-warning-text)]",
        dot: "bg-[var(--color-warning-text)]",
      };
    case "error":
    case "unhealthy":
      return {
        bg: "bg-[var(--color-error-bg)]",
        text: "text-[var(--color-error-text)]",
        dot: "bg-[var(--color-error-text)]",
      };
    case "stopped":
    case "disabled":
      return {
        bg: "bg-[var(--color-error-bg)]",
        text: "text-[var(--color-error-text)]",
        dot: "bg-[var(--color-error-text)]",
      };
    case "idle":
      return {
        bg: "bg-gray-100 dark:bg-gray-800",
        text: "text-gray-600 dark:text-gray-400",
        dot: "bg-gray-400",
      };
    default:
      return {
        bg: "bg-gray-100 dark:bg-gray-800",
        text: "text-gray-600 dark:text-gray-400",
        dot: "bg-gray-400",
      };
  }
}

function formatTimestamp(seconds?: number): string {
  if (!seconds || seconds <= 0) return "—";
  return new Date(seconds * 1000).toLocaleString();
}

/**
 * Full-screen detail overlay for a supervisord process or in-process application
 * (synthesis-engine, email-client). Renders via portal to `document.body`.
 *
 * Dispatches between two data-fetching strategies based on `type`:
 * - "service" → fetches supervisord process info + stderr logs
 * - "application" → fetches in-process engine state (pipeline stats, email accounts)
 */
export default function ServiceOverlay({ name, type, project, onClose }: ServiceOverlayProps) {
  // SSR guard: `createPortal(..., document.body)` cannot run during SSR because
  // `document` is undefined on the server. Defer rendering until after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [detail, setDetail] = useState<ServiceDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [logs, setLogs] = useState<ServiceLogs | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  const [appDetail, setAppDetail] = useState<AppDetail | null>(null);
  const [appDetailError, setAppDetailError] = useState<string | null>(null);
  const appRequestRef = useRef<AbortController | null>(null);
  const appRequestId = useRef(0);

  // Fetch functions wrapped in useCallback so they can be safely included
  // in the useEffect dependency array without causing infinite loops.
  const fetchServiceDetail = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/services/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setDetail(d.data);
      setDetailError(null);
    } catch (err: any) {
      setDetailError(err.message);
    }
  }, [name]);

  const fetchAppDetail = useCallback(async () => {
    appRequestRef.current?.abort();
    const controller = new AbortController();
    appRequestRef.current = controller;
    const requestId = ++appRequestId.current;
    setAppDetail(null); setAppDetailError(null);
    try {
      const query = project ? `?project=${encodeURIComponent(project)}` : "";
      const res = await fetch(`${API_URL}/services/applications/${encodeURIComponent(name)}${query}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (controller.signal.aborted || requestId !== appRequestId.current) return;
      setAppDetail(d.data);
    } catch (err: unknown) {
      if (!controller.signal.aborted && requestId === appRequestId.current) setAppDetailError(err instanceof Error ? err.message : "Application status unavailable");
    } finally { if (appRequestRef.current === controller) appRequestRef.current = null; }
  }, [name, project]);

  const fetchLogs = useCallback(async () => {
    if (type !== "service") return;
    setLogsLoading(true);
    setLogsError(null);
    try {
      const res = await fetch(
        `${API_URL}/services/${encodeURIComponent(name)}/logs?limit=100`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setLogs(d.data);
    } catch (err: any) {
      setLogsError(err.message);
    } finally {
      setLogsLoading(false);
    }
  }, [name, type]);

  useEffect(() => {
    if (type === "service") {
      fetchServiceDetail();
      fetchLogs();
    } else {
      fetchAppDetail();
    }
    return () => { appRequestId.current++; appRequestRef.current?.abort(); appRequestRef.current = null; };
  }, [type, fetchServiceDetail, fetchAppDetail, fetchLogs]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const isLoading = type === "service" ? !detail && !detailError : !appDetail && !appDetailError;
  const error = type === "service" ? detailError : appDetailError;
  const displayName = name;
  const displayDesc = type === "service"
    ? detail?.description
    : appDetail?.description;
  const displayState = type === "service"
    ? detail?.state ?? ""
    : appDetail?.state ?? "";

  const stats = appDetail?.stats;
  const statsTitle = appDetail?.name === "synthesis-engine" ? "Pipeline Stats"
    : appDetail?.name === "docs-workspace" ? "Documentation Stats" : "Task Stats";
  const statsRows: Array<[string, number | undefined]> = !stats ? []
    : appDetail?.name === "synthesis-engine" ? [["Total Observations", stats.totalObservations], ["Pending", stats.pendingCount], ["Processed", stats.processedCount], ["Traits", stats.traitCount]]
    : appDetail?.name === "docs-workspace" ? [["Spaces", stats.spaces], ["Pages", stats.pages], ["Drafts", stats.drafts]]
    : appDetail?.name === "tasks-board" ? [["Total tasks", stats.total], ["To do", stats.byColumn?.todo ?? 0], ["In progress", stats.byColumn?.in_progress ?? 0], ["In review", stats.byColumn?.review ?? 0], ["Done", stats.byColumn?.done ?? 0]] : [];

  const badge = stateBadgeStyle(displayState);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-w-2xl w-full mx-4 bg-[var(--color-surface)] rounded-2xl shadow-2xl overflow-y-auto animate-fadeIn"
        style={{ maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)]/50 transition-colors"
          aria-label="Close overlay"
        >
          ✕
        </button>

        <div className="p-6 sm:p-8">
          {error && (
            <div className="mb-6 bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded-lg p-4">
              <p className="text-[var(--color-error-text)] text-sm font-medium">
                Failed to load {type === "service" ? "service" : "application"} details
              </p>
              <p className="text-[var(--color-error-text)] text-xs mt-1">
                {error}
              </p>
            </div>
          )}

          <div className="mb-6 pr-8">
            <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">
              {displayName}
            </h2>
            {displayDesc && (
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                {displayDesc}
              </p>
            )}
            {isLoading && (
              <p className="text-sm text-[var(--color-text-muted)] mt-1 animate-pulse">
                Loading…
              </p>
            )}
          </div>

          {!isLoading && (
            <div className="flex items-center gap-3 mb-6">
              <div
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full ${badge.bg} ${badge.text} text-sm font-medium`}
              >
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full ${badge.dot}`}
                />
                {displayState}
              </div>
              {type === "service" && detail?.spawnerr && (
                <span className="text-xs text-[var(--color-error-text)] font-medium">
                  Spawn error
                </span>
              )}
            </div>
          )}

          {type === "service" && detail && (
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-[var(--color-surface-muted)] rounded-lg p-3">
                <span className="text-xs text-[var(--color-text-muted)] block mb-1">PID</span>
                <span className="text-sm font-mono text-[var(--color-text-primary)]">
                  {detail.pid ?? "—"}
                </span>
              </div>
              <div className="bg-[var(--color-surface-muted)] rounded-lg p-3">
                <span className="text-xs text-[var(--color-text-muted)] block mb-1">Port</span>
                <span className="text-sm font-mono text-[var(--color-text-primary)]">
                  {detail.port ?? "—"}
                </span>
              </div>
              <div className="bg-[var(--color-surface-muted)] rounded-lg p-3">
                <span className="text-xs text-[var(--color-text-muted)] block mb-1">Started</span>
                <span className="text-sm font-mono text-[var(--color-text-primary)]">
                  {detail.uptime > 0
                    ? new Date(Date.now() - detail.uptime * 1000).toLocaleString()
                    : "—"}
                </span>
              </div>
              <div className="bg-[var(--color-surface-muted)] rounded-lg p-3">
                <span className="text-xs text-[var(--color-text-muted)] block mb-1">Uptime</span>
                <span className="text-sm font-mono text-[var(--color-text-primary)]">
                  {formatUptime(detail.uptime)}
                </span>
              </div>
              <div className="bg-[var(--color-surface-muted)] rounded-lg p-3">
                <span className="text-xs text-[var(--color-text-muted)] block mb-1">Exit Code</span>
                <span
                  className={`text-sm font-mono ${
                    detail.exitstatus === 0
                      ? "text-[var(--color-success-text)]"
                      : detail.exitstatus != null
                        ? "text-[var(--color-error-text)]"
                        : "text-[var(--color-text-primary)]"
                  }`}
                >
                  {detail.exitstatus === 0
                    ? "Clean"
                    : detail.exitstatus != null
                      ? `Code ${detail.exitstatus}`
                      : "—"}
                </span>
              </div>
              <div className="bg-[var(--color-surface-muted)] rounded-lg p-3">
                <span className="text-xs text-[var(--color-text-muted)] block mb-1">Last Stop</span>
                <span className="text-sm font-mono text-[var(--color-text-primary)]">
                  {formatTimestamp(detail.stop)}
                </span>
              </div>
            </div>
          )}

          {type === "application" && appDetail && (
            <>
              <div className="grid grid-cols-2 gap-4 mb-6">
                {appDetail.intervalMs != null && (
                  <div className="bg-[var(--color-surface-muted)] rounded-lg p-3">
                    <span className="text-xs text-[var(--color-text-muted)] block mb-1">Interval</span>
                    <span className="text-sm font-mono text-[var(--color-text-primary)]">
                      {appDetail.intervalMs === 0 ? "Disabled" : `${Math.round(appDetail.intervalMs / 60000)}m`}
                    </span>
                  </div>
                )}
                {appDetail.lastRunAt !== undefined && (
                  <div className="bg-[var(--color-surface-muted)] rounded-lg p-3">
                    <span className="text-xs text-[var(--color-text-muted)] block mb-1">Last observation processed</span>
                    <span className="text-sm font-mono text-[var(--color-text-primary)]">
                      {(appDetail.lastProcessedAt ?? appDetail.lastRunAt) ? new Date((appDetail.lastProcessedAt ?? appDetail.lastRunAt)!).toLocaleString() : "—"}
                    </span>
                  </div>
                )}
                {appDetail.nextEstimate != null && (
                  <div className="bg-[var(--color-surface-muted)] rounded-lg p-3">
                    <span className="text-xs text-[var(--color-text-muted)] block mb-1">Next Run (est.)</span>
                    <span className="text-sm font-mono text-[var(--color-text-primary)]">
                      {new Date(appDetail.nextEstimate).toLocaleString()}
                    </span>
                  </div>
                )}
                {appDetail.detail && (
                  <div className="bg-[var(--color-surface-muted)] rounded-lg p-3">
                    <span className="text-xs text-[var(--color-text-muted)] block mb-1">Detail</span>
                    <span className="text-sm font-mono text-[var(--color-text-primary)]">
                      {appDetail.detail}
                    </span>
                  </div>
                )}
              </div>

              {appDetail.scope && <p className="mb-3 text-sm text-[var(--color-text-muted)]">{appDetail.scope.kind === "project" ? `Project: ${appDetail.scope.projectName}` : "Installation"}</p>}

              {statsRows.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">{statsTitle}</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {statsRows.map(([label, value]) => <div key={label} className="bg-[var(--color-surface-muted)] rounded-lg p-3">
                      <span className="text-xs text-[var(--color-text-muted)] block mb-1">{label}</span>
                      <span className="text-sm font-mono text-[var(--color-text-primary)]">{typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : "—"}</span>
                    </div>)}
                  </div>
                </div>
              )}

              {appDetail.engine && appDetail.engine.accounts.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                    Accounts ({appDetail.engine.accounts.length})
                  </h3>
                  {appDetail.engine.accounts.map((acct) => (
                    <div key={acct.accountId} className="mb-4 bg-[var(--color-surface-muted)] rounded-lg p-3">
                      <p className="text-sm font-medium text-[var(--color-text-primary)] mb-1">{acct.email}</p>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {acct.folders.map((folder) => {
                          const folderColor =
                            folder.state === "synced"
                              ? "text-[var(--color-success-text)]"
                              : folder.state === "error"
                                ? "text-[var(--color-error-text)]"
                                : "text-[var(--color-text-muted)]";
                          return (
                            <div key={folder.folder} className="bg-[var(--color-surface)] rounded p-2">
                              <span className="text-xs font-medium text-[var(--color-text-primary)]">{folder.folder}</span>
                              <span className={`text-xs ml-1.5 ${folderColor}`}>{folder.state}</span>
                              <div className="text-xs text-[var(--color-text-muted)] mt-1 space-y-0.5">
                                {folder.headersSynced > 0 && <div>Headers: {folder.headersSynced}/{folder.headersTotal}</div>}
                                {folder.bodiesCached > 0 && <div>Bodies: {folder.bodiesCached}/{folder.bodiesWindow}</div>}
                                {folder.lastSyncedAt && <div>Synced: {new Date(folder.lastSyncedAt).toLocaleString()}</div>}
                                {folder.lastError && <div className="text-[var(--color-error-text)]">Error: {folder.lastError}</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {appDetail.engine && appDetail.engine.accounts.length === 0 && (
                <div className="mb-6 bg-[var(--color-surface-muted)] rounded-lg p-4 text-center">
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Engine running — add an email account to begin syncing
                  </p>
                </div>
              )}
            </>
          )}

          {type === "service" && detail?.spawnerr && (
            <div className="mb-6">
              <span className="text-xs font-semibold text-[var(--color-error-text)] block mb-1">Spawn Error</span>
              <pre className="text-sm text-[var(--color-error-text)] bg-[var(--color-error-bg)] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono border border-[var(--color-error-border)]">
                {detail.spawnerr}
              </pre>
            </div>
          )}

          {type === "service" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Process Logs (stderr)</h3>
                <button onClick={fetchLogs}
                  className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors" aria-label="Refresh logs">
                  ↻ Refresh
                </button>
              </div>

              {logsLoading ? (
                <div className="flex items-center justify-center py-8 bg-[var(--color-surface-muted)] rounded-lg">
                  <div className="w-6 h-6 border-2 border-[var(--color-primary,#3b82f6)] border-t-transparent rounded-full animate-spin" />
                  <span className="ml-2 text-sm text-[var(--color-text-muted)]">Loading logs…</span>
                </div>
              ) : logsError ? (
                <div className="bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded-lg p-4">
                  <p className="text-[var(--color-error-text)] text-sm">Failed to load logs</p>
                  <p className="text-[var(--color-error-text)] text-xs mt-1">{logsError}</p>
                </div>
              ) : logs && logs.log ? (
                <>
                  <pre className="bg-gray-900 text-gray-100 text-xs leading-relaxed rounded-lg p-4 overflow-auto font-mono whitespace-pre-wrap" style={{ maxHeight: "40vh" }}>
                    {logs.log}
                  </pre>
                  {logs.more && (
                    <button onClick={fetchLogs} className="mt-2 text-xs text-[var(--color-primary,#3b82f6)] hover:underline">
                      ← Load older entries
                    </button>
                  )}
                </>
              ) : (
                <div className="bg-[var(--color-surface-muted)] rounded-lg p-6 text-center">
                  <p className="text-sm text-[var(--color-text-muted)]">No log output yet — process may have just started.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .animate-fadeIn {
          animation: overlayFadeIn 200ms ease-out;
        }
        @keyframes overlayFadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>,
    document.body
  );
}
