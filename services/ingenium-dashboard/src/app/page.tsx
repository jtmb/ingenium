"use client";
import { useState, useEffect, useCallback } from "react";
import DashboardCard from "./components/DashboardCard";
import DashboardSkeleton from "./components/DashboardSkeleton";
import { useProject } from "../lib/ProjectContext";
import { api, type DashboardSummary } from "../lib/api";

/** Format a relative time string from an ISO date. */
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

export default function Home() {
  const project = useProject();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [unavailableModules, setUnavailableModules] = useState<string[]>([]);

  const fetchSummary = useCallback(async () => {
    try {
      const result = await api.home.summary(project);
      setData(result.data);
      setUnavailableModules(result.unavailable ?? []);
      setError(null);
    } catch (err: any) {
      setError(err.message ?? "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setError(null);
    fetchSummary();
  }, [fetchSummary]);

  // Optional 60-second auto-refresh
  useEffect(() => {
    if (paused) return;
    const interval = setInterval(fetchSummary, 60_000);
    return () => clearInterval(interval);
  }, [fetchSummary, paused]);

  // ── Error state ──────────────────────────────────────────────────────────

  if (error && !loading && !data) {
    return (
      <div className="max-w-lg mx-auto mt-20 text-center">
        <div className="bg-[var(--color-error-bg)] border border-red-200 rounded-xl p-8">
          <h2 className="text-lg font-semibold text-red-700 dark:text-red-300 mb-2">
            Unable to load dashboard
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            {error}
          </p>
          <button
            onClick={() => {
              setLoading(true);
              setError(null);
              fetchSummary();
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Loading state ────────────────────────────────────────────────────────

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">
              Ingenium
            </h1>
          </div>
        </div>
        <DashboardSkeleton />
      </div>
    );
  }

  // ── Data-driven state ────────────────────────────────────────────────────

  const l = data.learning;
  const t = data.tasks;
  const j = data.jobs;
  const m = data.mail;

  const pendingObs = l?.pendingObservations ?? 0;
  const displayTraits = l?.displayTraitsCount ?? 0;

  const todoCount = t?.todoCount ?? 0;
  const inProgressCount = t?.inProgressCount ?? 0;
  const reviewCount = t?.reviewCount ?? 0;
  const nextTask = t?.nextTask ?? null;

  const jobTotal = j?.total ?? 0;
  const jobEnabled = j?.enabledCount ?? 0;
  const jobDisabled = jobTotal - jobEnabled;
  const failedRecently = j?.failedRecently ?? [];

  const mailAccounts = m?.accountCount ?? 0;
  const mailEngineHealthy = m?.engineHealthy ?? false;
  const mailEngineRunning = m?.engineRunning ?? false;

  const isUnavailable = (mod: string) => unavailableModules.includes(mod);

  let mailStatus = "Stopped";
  let mailStatusColor = "gray";
  if (mailEngineRunning && mailEngineHealthy) {
    mailStatus = "Healthy";
    mailStatusColor = "green";
  } else if (mailEngineRunning && !mailEngineHealthy) {
    mailStatus = "Degraded";
    mailStatusColor = "amber";
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">
            Ingenium
          </h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Project: <span className="font-medium">{project}</span>
          </p>
        </div>
        <button
          onClick={() => setPaused((p) => !p)}
          className={`text-xs px-3 py-1.5 rounded border border-[var(--color-border)] transition-colors ${
            paused
              ? "bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
          }`}
        >
          {paused ? "Auto-refresh paused" : "Auto-refresh on"}
        </button>
      </div>

      {/* Card grid — 2×2 on desktop, single column on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ── Card 1: Self-Learning (top-left) ──────────────────────────── */}
        <DashboardCard
          title="Self-Learning"
          loading={false}
          unavailable={isUnavailable("learning")}
          cta={
            pendingObs > 0
              ? { label: "Run Synthesis →", href: "/pipeline" }
              : { label: "View Pipeline →", href: "/pipeline" }
          }
        >
          {l === null ? (
            <p className="text-[var(--color-text-muted)]">
              No observations yet. The AI learns from your interactions.
            </p>
          ) : pendingObs === 0 && displayTraits === 0 ? (
            <p className="text-[var(--color-text-muted)]">
              No observations yet. The AI learns from your interactions.
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-[var(--color-text-primary)]">
                  {pendingObs}
                </span>
                <span>pending observations</span>
                {pendingObs > 0 && (
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 whitespace-nowrap ml-1">
                    Needs synthesis
                  </span>
                )}
              </div>
              <div>
                <span className="font-semibold text-[var(--color-text-primary)]">
                  {displayTraits}
                </span>{" "}
                display traits
              </div>
              <div>
                Last synthesis:{" "}
                <span className="font-medium text-[var(--color-text-primary)]">
                  {relativeTime(l.lastSynthesisAt)}
                </span>
              </div>
            </>
          )}
        </DashboardCard>

        {/* ── Card 2: Tasks (top-right) ─────────────────────────────────── */}
        <DashboardCard
          title="Tasks"
          unavailable={isUnavailable("tasks")}
          cta={
            t && (todoCount + inProgressCount + reviewCount) > 0
              ? { label: "Open Kanban →", href: "/tasks" }
              : { label: "Create your first task →", href: "/tasks" }
          }
        >
          {t === null ? (
            <p className="text-[var(--color-text-muted)]">No tasks found.</p>
          ) : todoCount + inProgressCount + reviewCount === 0 ? (
            <p className="text-[var(--color-text-muted)]">No pending tasks.</p>
          ) : (
            <>
              <div>
                <span className="font-semibold text-[var(--color-text-primary)]">
                  {todoCount}
                </span>{" "}
                todo ·{" "}
                <span className="font-semibold text-[var(--color-text-primary)]">
                  {inProgressCount}
                </span>{" "}
                in progress ·{" "}
                <span className="font-semibold text-[var(--color-text-primary)]">
                  {reviewCount}
                </span>{" "}
                in review
              </div>
              {nextTask ? (
                <div>
                  Next:{" "}
                  <span className="font-medium text-[var(--color-text-primary)]">
                    {nextTask.title}
                  </span>
                </div>
              ) : (
                <div className="text-[var(--color-text-muted)]">
                  No pending tasks
                </div>
              )}
            </>
          )}
        </DashboardCard>

        {/* ── Card 3: Jobs (bottom-left) ────────────────────────────────── */}
        <DashboardCard
          title="Jobs"
          unavailable={isUnavailable("jobs")}
          cta={
            j && jobTotal > 0
              ? { label: "Manage Jobs →", href: "/jobs" }
              : { label: "Set up an agent job →", href: "/jobs" }
          }
        >
          {j === null ? (
            <p className="text-[var(--color-text-muted)]">
              No jobs configured.
            </p>
          ) : jobTotal === 0 ? (
            <p className="text-[var(--color-text-muted)]">
              No jobs configured. Set up an agent job →
            </p>
          ) : (
            <>
              <div>
                <span className="font-semibold text-[var(--color-text-primary)]">
                  {jobEnabled}
                </span>{" "}
                enabled,{" "}
                <span className="font-semibold text-[var(--color-text-primary)]">
                  {jobDisabled}
                </span>{" "}
                disabled
              </div>
              {failedRecently.length > 0 && (
                <div className="space-y-1 mt-1">
                  {failedRecently.slice(0, 2).map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300 font-medium">
                        Failed
                      </span>
                      <span className="text-[var(--color-text-secondary)] truncate">
                        {f.name}
                      </span>
                      <span className="text-[var(--color-text-muted)] shrink-0">
                        {relativeTime(f.finishedAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </DashboardCard>

        {/* ── Card 4: Mail (bottom-right) ───────────────────────────────── */}
        <DashboardCard
          title="Mail"
          unavailable={isUnavailable("mail")}
          cta={
            m && mailAccounts > 0
              ? { label: "Open Mail →", href: "/mail" }
              : { label: "Connect an email account →", href: "/mail" }
          }
        >
          {m === null ? (
            <p className="text-[var(--color-text-muted)]">
              No mail accounts connected.
            </p>
          ) : mailAccounts === 0 ? (
            <p className="text-[var(--color-text-muted)]">
              Connect an email account →
            </p>
          ) : (
            <>
              <div>
                <span className="font-semibold text-[var(--color-text-primary)]">
                  {mailAccounts}
                </span>{" "}
                account{mailAccounts !== 1 ? "s" : ""} connected
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                    mailStatusColor === "green"
                      ? "bg-green-500"
                      : mailStatusColor === "amber"
                        ? "bg-amber-500"
                        : "bg-gray-400"
                  }`}
                />
                <span className="font-medium text-[var(--color-text-primary)]">
                  {mailStatus}
                </span>
              </div>
            </>
          )}
        </DashboardCard>
      </div>
    </div>
  );
}
