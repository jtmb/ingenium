"use client";
import { useState, useEffect, useCallback } from "react";
import ServiceOverlay from "./ServiceOverlay";

// ── Types ────────────────────────────────────────────────────────────────────

type ServiceState = "running" | "starting" | "error" | "stopped";

interface Service {
  name: string;
  state: ServiceState;
  uptime: number; // seconds
  restartCount: number;
  port: number;
  description: string;
  pid?: number;
  exitstatus?: number;
  spawnerr?: string;
  stop?: number;
}

interface ApplicationInfo {
  name: string;
  state: "healthy" | "degraded" | "stopped" | "starting" | "idle" | "disabled" | "error" | "unknown";
  description: string;
  detail?: string;
}

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

interface StatusResponse {
  data: {
    services: Service[];
    applications: ApplicationInfo[];
    overall: "healthy" | "degraded" | "down";
    error?: string;
  };
}

// ── Constants ────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4097/api/v1";
const POLL_INTERVAL = 2000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function stateBadge(state: ServiceState): {
  label: string;
  bg: string;
  text: string;
  dotClass: string;
} {
  switch (state) {
    case "running":
      return {
        label: "Running",
        bg: "bg-[var(--color-success-bg)]",
        text: "text-[var(--color-success-text)]",
        dotClass: "status-dot-green",
      };
    case "starting":
      return {
        label: "Starting",
        bg: "bg-[var(--color-warning-bg)]",
        text: "text-[var(--color-warning-text)]",
        dotClass: "status-dot-amber",
      };
    case "error":
      return {
        label: "Error",
        bg: "bg-[var(--color-error-bg)]",
        text: "text-[var(--color-error-text)]",
        dotClass: "status-dot-red",
      };
    case "stopped":
      return {
        label: "Stopped",
        bg: "bg-[var(--color-error-bg)]",
        text: "text-[var(--color-error-text)]",
        dotClass: "status-dot-red",
      };
  }
}

function appStateBadge(state: ApplicationInfo["state"]): {
  label: string;
  bg: string;
  text: string;
  dotClass: string;
} {
  switch (state) {
    case "healthy":
      return {
        label: "Healthy",
        bg: "bg-[var(--color-success-bg)]",
        text: "text-[var(--color-success-text)]",
        dotClass: "status-dot-green",
      };
    case "degraded":
      return {
        label: "Degraded",
        bg: "bg-[var(--color-warning-bg)]",
        text: "text-[var(--color-warning-text)]",
        dotClass: "status-dot-amber",
      };
    case "stopped":
      return {
        label: "Stopped",
        bg: "bg-red-50",
        text: "text-red-700",
        dotClass: "status-dot-red",
      };
    case "starting":
      return {
        label: "Starting",
        bg: "bg-[var(--color-warning-bg)]",
        text: "text-[var(--color-warning-text)]",
        dotClass: "status-dot-amber",
      };
    case "idle":
      return {
        label: "Idle",
        bg: "bg-gray-50",
        text: "text-gray-600",
        dotClass: "status-dot-gray",
      };
    case "disabled":
      return {
        label: "Disabled",
        bg: "bg-gray-50",
        text: "text-gray-500",
        dotClass: "status-dot-gray",
      };
    case "error":
      return {
        label: "Error",
        bg: "bg-red-50",
        text: "text-red-700",
        dotClass: "status-dot-red",
      };
    default:
      return {
        label: "Unknown",
        bg: "bg-gray-50",
        text: "text-gray-500",
        dotClass: "status-dot-gray",
      };
  }
}

function healthBanner(
  overall: string,
  degradedCount: number
): { label: string; bg: string; text: string } {
  if (overall === "healthy") {
    return {
      label: "All healthy",
      bg: "bg-[var(--color-success-bg)]",
      text: "text-[var(--color-success-text)]",
    };
  }
  if (overall === "degraded") {
    return {
      label: `${degradedCount} component(s) degraded`,
      bg: "bg-[var(--color-warning-bg)]",
      text: "text-[var(--color-warning-text)]",
    };
  }
  return {
    label: "All down",
    bg: "bg-[var(--color-error-bg)]",
    text: "text-[var(--color-error-text)]",
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function StatusPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState<string | null>(null);

  const handleServiceClick = (name: string) => {
    setSelectedService(name);
  };

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/services/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: StatusResponse = await res.json();
      setStatus(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
      // Keep stale data visible if we have it
      if (!status) {
        setStatus(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const services = status?.data?.services ?? [];
  const applications = status?.data?.applications ?? [];
  const overall = status?.data?.overall ?? "down";
  const degradedServiceCount = services.filter((s) => s.state !== "running").length;
  const degradedAppCount = applications.filter(
    (a) => a.state === "error" || a.state === "stopped"
  ).length;
  const effectiveOverall =
    degradedAppCount > 0 && overall === "healthy" ? "degraded" : overall;
  const banner = healthBanner(effectiveOverall, degradedServiceCount + degradedAppCount);

  // Show error banner if API itself is unreachable
  if (error && !status) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Service Status</h1>
          <p className="text-[var(--color-text-muted)] mt-1">Real-time process monitoring via supervisord</p>
        </div>
        <div className="bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded p-6">
          <p className="text-[var(--color-error-text)] font-semibold">Cannot reach status API</p>
          <p className="text-[var(--color-error-text)] text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero header */}
      <div>
        <h1 className="text-3xl font-bold">Service Status</h1>
        <p className="text-[var(--color-text-muted)] mt-1">
          Real-time process monitoring via supervisord
          <span className="ml-2 text-xs">(updates every 2s)</span>
        </p>
      </div>

      {/* Overall health banner */}
      <div className={`${banner.bg} border border-[var(--color-border)] rounded p-4 flex items-center gap-3`}>
        <span
          className={`inline-block w-3 h-3 rounded-full ${
            effectiveOverall === "healthy"
              ? "bg-[var(--color-success-text)]"
              : effectiveOverall === "degraded"
              ? "bg-[var(--color-warning-text)] animate-pulse"
              : "bg-[var(--color-error-text)]"
          }`}
        />
        <span className={`font-semibold text-lg ${banner.text}`}>{banner.label}</span>
      </div>

      {/* Service cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {services.map((svc) => {
          const badge = stateBadge(svc.state);
          return (
            <div
              key={svc.name}
              className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-6 cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => handleServiceClick(svc.name)}
            >
              {/* Service name */}
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                {svc.name}
              </h2>
              <p className="text-xs text-[var(--color-text-muted)] mb-4 min-h-[2rem]">
                {svc.description}
              </p>

              {/* State badge */}
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${badge.bg} ${badge.text} text-xs font-medium mb-4`}>
                <span className={`inline-block w-2 h-2 rounded-full ${badge.dotClass}`} />
                {badge.label}
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-[var(--color-text-muted)] text-xs">Uptime</span>
                  <p className="text-[var(--color-text-primary)] font-mono text-sm">
                    {formatUptime(svc.uptime)}
                  </p>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)] text-xs">Port</span>
                  <p className="text-[var(--color-text-primary)] font-mono text-sm">
                    {svc.port || "—"}
                  </p>
                </div>
              </div>

              {/* Restart info */}
              {svc.restartCount > 0 && (
                <p className="text-xs text-[var(--color-warning-text)] mt-3">
                  Restarted {svc.restartCount}×
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Application Services section */}
      {applications.length > 0 && (
        <>
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
            Application Services
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {applications.map((app) => {
              const badge = appStateBadge(app.state);
              return (
                <div
                  key={app.name}
                  className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-4 cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => handleServiceClick(app.name)}
                >
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
                    {app.name}
                  </h3>
                  <p className="text-xs text-[var(--color-text-muted)] mb-3 min-h-[1.5rem]">
                    {app.description}
                  </p>
                  <div
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full ${badge.bg} ${badge.text} text-xs font-medium`}
                  >
                    <span className={`inline-block w-2 h-2 rounded-full ${badge.dotClass}`} />
                    {badge.label}
                  </div>
                  {app.detail && (
                    <p className="text-xs text-[var(--color-text-muted)] mt-2">{app.detail}</p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Empty state */}
      {services.length === 0 && !error && (
        <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-12 text-center">
          <p className="text-[var(--color-text-muted)]">No services detected.</p>
          <p className="text-[var(--color-text-muted)] text-sm mt-1">
            Ensure supervisord XML-RPC is enabled on port 9001.
          </p>
        </div>
      )}

      {/* Error state (non-fatal — API returned but with an error field) */}
      {status?.data?.error && services.length === 0 && (
        <div className="bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded p-4 mt-4">
          <p className="text-[var(--color-error-text)] text-sm">RPC error: {status.data.error}</p>
        </div>
      )}

      {/* Service detail overlay */}
      {selectedService && (
        <ServiceOverlay
          name={selectedService}
          onClose={() => setSelectedService(null)}
        />
      )}

      {/* CSS keyframes for status dot animations */}
      <style jsx>{`
        .status-dot-green {
          background-color: var(--color-success-text, #16a34a);
        }
        .status-dot-amber {
          background-color: var(--color-warning-text, #d97706);
          animation: statusPulse 1.2s ease-in-out infinite;
        }
        .status-dot-red {
          background-color: var(--color-error-text, #dc2626);
        }
        .status-dot-gray {
          background-color: #9ca3af;
        }
        @keyframes statusPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
