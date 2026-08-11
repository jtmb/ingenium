"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import ServiceOverlay from "./ServiceOverlay";
import { badgeTones } from "../../lib/badgeTones";
import { getApiBase } from "@/lib/api";
import { formatUptime } from "@/lib/time";

// ── Types ────────────────────────────────────────────────────────────────────

type ServiceState = "running" | "starting" | "error" | "stopped";
type ApplicationState =
  | "healthy"
  | "degraded"
  | "unhealthy"
  | "stopped"
  | "starting"
  | "idle"
  | "disabled"
  | "error"
  | "unknown";

interface Service {
  name: string;
  state: ServiceState;
  /** Processes are required unless the API explicitly marks them optional. */
  required?: boolean;
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
  state: ApplicationState;
  description: string;
  detail?: string;
  /** Optional applications (for example, unconfigured email) do not degrade aggregate health. */
  required?: boolean;
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

const API_URL = getApiBase();
// 2s poll matches supervisord's native XML-RPC update cadence and gives
// near-real-time feedback for process start/stop/restart cycles.
const POLL_INTERVAL = 2000;

// ── Helpers ──────────────────────────────────────────────────────────────────

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
    case "unhealthy":
      return {
        label: "Unhealthy",
        bg: badgeTones('error'),
        text: "",
        dotClass: "status-dot-red",
      };
    case "stopped":
      return {
        label: "Stopped",
        bg: badgeTones('error'),
        text: "",
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
        bg: badgeTones('muted'),
        text: "",
        dotClass: "status-dot-gray",
      };
    case "disabled":
      return {
        label: "Disabled",
        bg: badgeTones('muted'),
        text: "",
        dotClass: "status-dot-gray",
      };
    case "error":
      return {
        label: "Error",
        bg: badgeTones('error'),
        text: "",
        dotClass: "status-dot-red",
      };
    default:
      return {
        label: "Unknown",
        bg: badgeTones('muted'),
        text: "",
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

/**
 * StatusPage — Real-time service monitoring via supervisord XML-RPC.
 *
 * Two tiers of services:
 *   1. supervisord-managed processes (API, Dashboard, opencode-web, ttyd)
 *   2. In-process application services (synthesis-engine, email-client)
 *
 * `effectiveOverall` defends against stale API responses by also considering
 * required process and in-process application states. The API is the
 * authoritative aggregate-health source and normally supplies this
 * degradation itself.
 *
 * The ServiceOverlay component (lazy-loaded) provides PID, exit status,
 * spawn error details, and recent log tail.
 */
export default function StatusPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedCardType, setSelectedCardType] = useState<"service" | "application" | null>(null);
  const statusRequestRef = useRef<AbortController | null>(null);
  const statusRequestIdRef = useRef(0);

  const handleServiceClick = (name: string) => {
    // Determine whether this card is a supervisord service or an in-process application.
    // Check the services array first (supervisord processes), then applications.
    const isService = services.some((svc) => svc.name === name);
    const isApp = applications.some((app) => app.name === name);
    // Default to "service" if not found in either list (edge case: stale state).
    const cardType: "service" | "application" = isService ? "service" : isApp ? "application" : "service";
    setSelectedCardType(cardType);
    setSelectedService(name);
  };

  const fetchStatus = useCallback(async () => {
    if (statusRequestRef.current) return;
    const controller = new AbortController();
    const requestId = ++statusRequestIdRef.current;
    statusRequestRef.current = controller;
    try {
      const res = await fetch(`${API_URL}/services/status`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: StatusResponse = await res.json();
      if (controller.signal.aborted || requestId !== statusRequestIdRef.current) return;
      setStatus(data);
      setError(null);
    } catch (err: any) {
      if (controller.signal.aborted || requestId !== statusRequestIdRef.current) return;
      setError(err.message);
    } finally {
      if (requestId === statusRequestIdRef.current) setLoading(false);
      if (statusRequestRef.current === controller) statusRequestRef.current = null;
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => void fetchStatus(), POLL_INTERVAL);
    return () => {
      clearInterval(interval);
      statusRequestIdRef.current += 1;
      statusRequestRef.current?.abort();
      statusRequestRef.current = null;
    };
  }, [fetchStatus]);

  const services = status?.data?.services ?? [];
  const applications = status?.data?.applications ?? [];
  const overall = status?.data?.overall ?? "down";
  const degradedServiceCount = services.filter(
    (service) => service.required !== false && service.state !== "running"
  ).length;
  const degradedAppCount = applications.filter(
    (a) => a.required !== false && a.state !== "healthy"
  ).length;
  const effectiveOverall =
    overall === "healthy" && (degradedServiceCount > 0 || degradedAppCount > 0)
      ? "degraded"
      : overall;
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

  if (loading && !status) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Service Status</h1>
          <p className="mt-1 text-[var(--color-text-muted)]">Real-time process monitoring via supervisord</p>
        </div>
        <p className="text-sm text-[var(--color-text-muted)]" aria-busy="true">Loading service status...</p>
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
            <button
              type="button"
              key={svc.name}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-left hover:shadow-md transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
              onClick={() => handleServiceClick(svc.name)}
              aria-label={`View ${svc.name} service details`}
            >
              <span className="mb-1 block text-lg font-semibold text-[var(--color-text-primary)]">{svc.name}</span>
              <span className="mb-4 block min-h-[2rem] text-xs text-[var(--color-text-muted)]">{svc.description}</span>
              <span className={`mb-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${badge.bg} ${badge.text}`}>
                <span className={`inline-block w-2 h-2 rounded-full ${badge.dotClass}`} />
                {badge.label}
              </span>
              <span className="grid grid-cols-2 gap-3 text-sm">
                <span>
                  <span className="text-[var(--color-text-muted)] text-xs">Uptime</span>
                  <span className="block font-mono text-sm text-[var(--color-text-primary)]">{formatUptime(svc.uptime)}</span>
                </span>
                <span>
                  <span className="text-[var(--color-text-muted)] text-xs">Port</span>
                  <span className="block font-mono text-sm text-[var(--color-text-primary)]">{svc.port || "—"}</span>
                </span>
              </span>
              {svc.restartCount > 0 && <span className="mt-3 block text-xs text-[var(--color-warning-text)]">Restarted {svc.restartCount}×</span>}
            </button>
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
                <button
                  type="button"
                  key={app.name}
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left hover:shadow-md transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
                  onClick={() => handleServiceClick(app.name)}
                  aria-label={`View ${app.name} application details`}
                >
                  <span className="mb-1 block text-sm font-semibold text-[var(--color-text-primary)]">{app.name}</span>
                  <span className="mb-3 block min-h-[1.5rem] text-xs text-[var(--color-text-muted)]">{app.description}</span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${badge.bg} ${badge.text}`}>
                    <span className={`inline-block w-2 h-2 rounded-full ${badge.dotClass}`} />
                    {badge.label}
                  </span>
                  {app.detail && <span className="mt-2 block text-xs text-[var(--color-text-muted)]">{app.detail}</span>}
                </button>
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
      {selectedService && selectedCardType && (
        <ServiceOverlay
          name={selectedService}
          type={selectedCardType}
          onClose={() => { setSelectedService(null); setSelectedCardType(null); }}
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
