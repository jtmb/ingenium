"use client";
import type { HealthData } from "../../lib/api";

interface HealthStripProps {
  data: HealthData | null;
  loading?: boolean;
}

/**
 * Health Strip — compact horizontal indicator for all service health states.
 */
export default function HealthStrip({ data, loading }: HealthStripProps) {
  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 hover:shadow-md transition-shadow">
        <div className="animate-pulse flex items-center gap-4">
          <div className="h-3 bg-[var(--color-surface-muted)] rounded w-24" />
          <div className="h-3 bg-[var(--color-surface-muted)] rounded w-20" />
          <div className="h-3 bg-[var(--color-surface-muted)] rounded w-32" />
        </div>
      </div>
    );
  }

  // ── Missing state ──────────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 hover:shadow-md transition-shadow">
        <p className="text-sm text-[var(--color-text-muted)]">
          Health data unavailable
        </p>
      </div>
    );
  }

  // ── Status helpers ─────────────────────────────────────────────────────────
  const dot = (status: string) => {
    let bg = "bg-gray-400";
    if (status === "ok" || status === "running" || status === "healthy") bg = "bg-green-500";
    if (status === "degraded") bg = "bg-amber-500";
    if (status === "down" || status === "error" || status === "stopped" || status === "unhealthy") bg = "bg-red-500";
    return <span className={`inline-block w-2 h-2 rounded-full ${bg} shrink-0`} />;
  };

  // Compute overall summary
  const allServicesOk = data.services.every(
    (s) => s.status === "running" || s.status === "healthy"
  );
  const apiOk = data.api.status === "ok";
  const ocOk = data.opencode.status === "ok";

  let summary = "All systems operational";
  let summaryClass = "text-[var(--color-success-text)]";
  if (!apiOk || !ocOk || !allServicesOk) {
    const downCount = [
      apiOk ? 0 : 1,
      ocOk ? 0 : 1,
      ...data.services.map((s) => (s.status === "running" || s.status === "healthy" ? 0 : 1)),
    ].reduce((a, b) => a + b, 0);
    summary = `${downCount} service${downCount !== 1 ? "s" : ""} degraded`;
    summaryClass = "text-[var(--color-warning-text)]";
  }
  if (!apiOk && !ocOk && data.services.every((s) => s.status !== "running")) {
    summary = "Multiple services down";
    summaryClass = "text-[var(--color-error-text)]";
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 hover:shadow-md transition-shadow">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm">
        {/* Summary */}
        <span className={`font-semibold ${summaryClass}`}>
          {dot(apiOk ? "ok" : "down")}{" "}
          {summary}
        </span>

        <span className="text-[var(--color-text-muted)] select-none">|</span>

        {/* API */}
        <span className="inline-flex items-center gap-1.5">
          {dot(data.api.status)}
          <span className="text-[var(--color-text-secondary)]">API</span>
          <span className="text-xs text-[var(--color-text-muted)]">
            {data.api.status === "ok" ? "OK" : data.api.status === "degraded" ? "Degraded" : "Down"}
          </span>
        </span>

        {/* Dashboard */}
        <span className="inline-flex items-center gap-1.5">
          {dot(data.dashboard?.status === "ok" ? "ok" : "down")}
          <span className="text-[var(--color-text-secondary)]">Dashboard</span>
          <span className="text-xs text-[var(--color-text-muted)]">
            {data.dashboard?.status === "ok" ? "OK" : "Down"}
          </span>
        </span>

        {/* OpenCode */}
        <span className="inline-flex items-center gap-1.5">
          {dot(data.opencode.status === "ok" ? "ok" : "down")}
          <span className="text-[var(--color-text-secondary)]">OpenCode</span>
          <span className="text-xs text-[var(--color-text-muted)]">
            {data.opencode.status === "ok" ? "OK" : "Down"}
          </span>
        </span>

        {/* Supervisord + application services */}
        {data.services.length > 0 && (
          <>
            <span className="text-[var(--color-text-muted)] select-none">|</span>
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              {data.services.map((svc, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  {dot(svc.status)}
                  <span className="text-xs text-[var(--color-text-muted)]">{svc.name}</span>
                </span>
              ))}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
