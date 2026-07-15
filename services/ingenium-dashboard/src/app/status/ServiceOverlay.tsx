"use client";
import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

// ── Types ────────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4097/api/v1";

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

interface ServiceOverlayProps {
  name: string;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stateBadgeStyle(state: string) {
  switch (state) {
    case "running":
      return {
        bg: "bg-[var(--color-success-bg)]",
        text: "text-[var(--color-success-text)]",
        dot: "bg-[var(--color-success-text)]",
      };
    case "starting":
      return {
        bg: "bg-[var(--color-warning-bg)]",
        text: "text-[var(--color-warning-text)]",
        dot: "bg-[var(--color-warning-text)]",
      };
    case "error":
      return {
        bg: "bg-[var(--color-error-bg)]",
        text: "text-[var(--color-error-text)]",
        dot: "bg-[var(--color-error-text)]",
      };
    case "stopped":
      return {
        bg: "bg-[var(--color-error-bg)]",
        text: "text-[var(--color-error-text)]",
        dot: "bg-[var(--color-error-text)]",
      };
    default:
      return {
        bg: "bg-gray-100 dark:bg-gray-800",
        text: "text-gray-600 dark:text-gray-400",
        dot: "bg-gray-400",
      };
  }
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTimestamp(seconds?: number): string {
  if (!seconds || seconds <= 0) return "—";
  return new Date(seconds * 1000).toLocaleString();
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ServiceOverlay({ name, onClose }: ServiceOverlayProps) {
  const [detail, setDetail] = useState<ServiceDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [logs, setLogs] = useState<ServiceLogs | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchDetail = useCallback(async () => {
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

  const fetchLogs = useCallback(async () => {
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
  }, [name]);

  useEffect(() => {
    fetchDetail();
    fetchLogs();
  }, [fetchDetail, fetchLogs]);

  // ── Escape key dismiss ───────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const badge = stateBadgeStyle(detail?.state ?? "");

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
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)]/50 transition-colors"
          aria-label="Close overlay"
        >
          ✕
        </button>

        <div className="p-6 sm:p-8">
          {/* ── Error state ─────────────────────────────────────────────── */}
          {detailError && (
            <div className="mb-6 bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded-lg p-4">
              <p className="text-[var(--color-error-text)] text-sm font-medium">
                Failed to load service details
              </p>
              <p className="text-[var(--color-error-text)] text-xs mt-1">
                {detailError}
              </p>
            </div>
          )}

          {/* ── Header ──────────────────────────────────────────────────── */}
          <div className="mb-6 pr-8">
            <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">
              {name}
            </h2>
            {detail && (
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                {detail.description}
              </p>
            )}
            {!detail && !detailError && (
              <p className="text-sm text-[var(--color-text-muted)] mt-1 animate-pulse">
                Loading…
              </p>
            )}
          </div>

          {/* ── State badge ─────────────────────────────────────────────── */}
          {detail && (
            <div className="flex items-center gap-3 mb-6">
              <div
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full ${badge.bg} ${badge.text} text-sm font-medium`}
              >
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full ${badge.dot}`}
                />
                {detail.state}
              </div>
              {detail.spawnerr && (
                <span className="text-xs text-[var(--color-error-text)] font-medium">
                  Spawn error
                </span>
              )}
            </div>
          )}

          {/* ── Diagnostics grid ────────────────────────────────────────── */}
          {detail && (
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-[var(--color-surface-muted)] rounded-lg p-3">
                <span className="text-xs text-[var(--color-text-muted)] block mb-1">
                  PID
                </span>
                <span className="text-sm font-mono text-[var(--color-text-primary)]">
                  {detail.pid ?? "—"}
                </span>
              </div>
              <div className="bg-[var(--color-surface-muted)] rounded-lg p-3">
                <span className="text-xs text-[var(--color-text-muted)] block mb-1">
                  Port
                </span>
                <span className="text-sm font-mono text-[var(--color-text-primary)]">
                  {detail.port ?? "—"}
                </span>
              </div>
              <div className="bg-[var(--color-surface-muted)] rounded-lg p-3">
                <span className="text-xs text-[var(--color-text-muted)] block mb-1">
                  Started
                </span>
                <span className="text-sm font-mono text-[var(--color-text-primary)]">
                  {detail.uptime > 0
                    ? new Date(Date.now() - detail.uptime * 1000).toLocaleString()
                    : "—"}
                </span>
              </div>
              <div className="bg-[var(--color-surface-muted)] rounded-lg p-3">
                <span className="text-xs text-[var(--color-text-muted)] block mb-1">
                  Uptime
                </span>
                <span className="text-sm font-mono text-[var(--color-text-primary)]">
                  {formatUptime(detail.uptime)}
                </span>
              </div>
              <div className="bg-[var(--color-surface-muted)] rounded-lg p-3">
                <span className="text-xs text-[var(--color-text-muted)] block mb-1">
                  Exit Code
                </span>
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
                <span className="text-xs text-[var(--color-text-muted)] block mb-1">
                  Last Stop
                </span>
                <span className="text-sm font-mono text-[var(--color-text-primary)]">
                  {formatTimestamp(detail.stop)}
                </span>
              </div>
            </div>
          )}

          {/* ── Spawn error detail ──────────────────────────────────────── */}
          {detail?.spawnerr && (
            <div className="mb-6">
              <span className="text-xs font-semibold text-[var(--color-error-text)] block mb-1">
                Spawn Error
              </span>
              <pre className="text-sm text-[var(--color-error-text)] bg-[var(--color-error-bg)] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono border border-[var(--color-error-border)]">
                {detail.spawnerr}
              </pre>
            </div>
          )}

          {/* ── Process Logs ────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                Process Logs (stderr)
              </h3>
              <button
                onClick={fetchLogs}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                aria-label="Refresh logs"
              >
                ↻ Refresh
              </button>
            </div>

            {logsLoading ? (
              <div className="flex items-center justify-center py-8 bg-[var(--color-surface-muted)] rounded-lg">
                <div className="w-6 h-6 border-2 border-[var(--color-primary,#3b82f6)] border-t-transparent rounded-full animate-spin" />
                <span className="ml-2 text-sm text-[var(--color-text-muted)]">
                  Loading logs…
                </span>
              </div>
            ) : logsError ? (
              <div className="bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded-lg p-4">
                <p className="text-[var(--color-error-text)] text-sm">
                  Failed to load logs
                </p>
                <p className="text-[var(--color-error-text)] text-xs mt-1">
                  {logsError}
                </p>
              </div>
            ) : logs && logs.log ? (
              <>
                <pre
                  className="bg-gray-900 text-gray-100 text-xs leading-relaxed rounded-lg p-4 overflow-auto font-mono whitespace-pre-wrap"
                  style={{ maxHeight: "40vh" }}
                >
                  {logs.log}
                </pre>
                {logs.more && (
                  <button
                    onClick={fetchLogs}
                    className="mt-2 text-xs text-[var(--color-primary,#3b82f6)] hover:underline"
                  >
                    ← Load older entries
                  </button>
                )}
              </>
            ) : (
              <div className="bg-[var(--color-surface-muted)] rounded-lg p-6 text-center">
                <p className="text-sm text-[var(--color-text-muted)]">
                  No log output yet — process may have just started.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Animations ─────────────────────────────────────────────────── */}
      <style jsx>{`
        .animate-fadeIn {
          animation: overlayFadeIn 200ms ease-out;
        }
        @keyframes overlayFadeIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>,
    document.body
  );
}
