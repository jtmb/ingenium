"use client";
import { useState, useEffect, useCallback } from "react";
import QuickActions from "./components/QuickActions";
import AttentionQueue from "./components/AttentionQueue";
import ResumeWork from "./components/ResumeWork";
import ActivityTimeline from "./components/ActivityTimeline";
import HealthStrip from "./components/HealthStrip";
import { useProject } from "../lib/ProjectContext";
import { api, type DashboardSummary } from "../lib/api";

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

  // 60s polling is appropriate for an operational dashboard — fast enough to
  // reflect recent activity but slow enough to avoid hammering the API backend
  // which aggregates data from multiple internal services.
  useEffect(() => {
    if (paused) return;
    const interval = setInterval(fetchSummary, 60_000);
    return () => clearInterval(interval);
  }, [fetchSummary, paused]);

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6"
              data-testid="dashboard-skeleton-card"
            >
              <div className="animate-pulse space-y-3">
                <div className="h-5 bg-[var(--color-surface-muted)] rounded w-1/3" />
                <div className="h-4 bg-[var(--color-surface-muted)] rounded w-2/3" />
                <div className="h-4 bg-[var(--color-surface-muted)] rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const isUnavailable = (mod: string) => unavailableModules.includes(mod);

  const unavailableLabels: Record<string, string> = {
    "attention.tasks": "Attention — Tasks",
    "attention.jobs": "Attention — Jobs",
    resume: "Resume Work",
    activity: "Activity Timeline",
    health: "Health",
    "learning.synthesis": "Learning — Synthesis",
    "learning.personality": "Learning — Personality",
    tasks: "Tasks",
    jobs: "Jobs",
    mail: "Mail",
  };

  const sectionsWithIssues = unavailableModules
    .map((m) => unavailableLabels[m] ?? m)
    .filter(Boolean);

  return (
    <div className="space-y-4">
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

      {sectionsWithIssues.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg
          bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)]
          text-sm text-[var(--color-warning-text)]">
          <span className="font-medium">Some sections are unavailable:</span>
          <span className="text-[var(--color-text-secondary)]">
            {sectionsWithIssues.join(", ")}
          </span>
        </div>
      )}

      <QuickActions />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AttentionQueue
          data={data.attention}
          loading={isUnavailable("attention.tasks") && isUnavailable("attention.jobs")}
        />
        <ResumeWork
          data={data.resume}
          loading={isUnavailable("resume")}
        />
      </div>

      <ActivityTimeline
        items={data.activity}
        loading={isUnavailable("activity")}
      />

      <HealthStrip
        data={data.health}
        loading={isUnavailable("health")}
      />
    </div>
  );
}
