"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  getVSCodeAvailability,
  getVSCodeUrl,
  VSCODE_GATEWAY_URL,
  type VSCodeAvailability,
} from "@/lib/runtime-urls";

type ServicePhase = "loading" | "starting" | "ready" | "missing" | "stopped" | "error";

interface ServiceState {
  phase: ServicePhase;
  detail: string | null;
}

const INITIAL_SERVICE_STATE: ServiceState = { phase: "loading", detail: null };

export const VSCODE_STATUS_MAX_ATTEMPTS = 3;
export const VSCODE_STATUS_POLL_MS = 2_000;
export const VSCODE_STATUS_TIMEOUT_MS = 4_000;
export const VSCODE_FRAME_TIMEOUT_MS = 15_000;

function getVSCodeServiceState(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const services = (data as { services?: unknown }).services;
  if (!Array.isArray(services)) return null;

  const vscode = services.find((service): service is { name?: unknown; state?: unknown } => (
    Boolean(service)
    && typeof service === "object"
    && (service as { name?: unknown }).name === "VS Code"
  ));

  return typeof vscode?.state === "string" ? vscode.state : vscode ? "unknown" : null;
}

function TrustNotice() {
  return (
    <p className="mt-3 text-xs text-[var(--color-text-muted)]">
      This is a local-only, administrator-grade workspace and is unsupported for remote, LAN, shared, or untrusted users.
    </p>
  );
}

interface FrameNoticeProps {
  title: string;
  detail: string;
  role: "status" | "alert";
  onRetry?: () => void;
  noticeRef: RefObject<HTMLDivElement | null>;
}

function FrameNotice({ title, detail, role, onRetry, noticeRef }: FrameNoticeProps) {
  return (
    <div className="absolute inset-0 flex min-w-0 items-center justify-center overflow-auto bg-[var(--color-surface-muted)] p-4 sm:p-6">
      <div
        ref={noticeRef}
        role={role}
        aria-live={role === "status" ? "polite" : "assertive"}
        aria-atomic="true"
        tabIndex={role === "alert" ? -1 : undefined}
        className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-center text-[var(--color-text-primary)] hover:shadow-md transition-shadow"
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{detail}</p>
        {role === "alert" && <TrustNotice />}
        {onRetry && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <a
              href={VSCODE_GATEWAY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded text-sm font-medium text-[var(--color-text-link)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
            >
              Open VS Code in a new tab
            </a>
            <button
              type="button"
              onClick={onRetry}
              className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
            >
              Retry VS Code
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Dedicated VS Code iframe boundary. It deliberately does not share OpenCode
 * URL, health, or mode state: code-server is a fixed, local-only process.
 */
export default function VSCodeFrame() {
  const [availability, setAvailability] = useState<VSCodeAvailability | null>(null);
  const [service, setService] = useState<ServiceState>(INITIAL_SERVICE_STATE);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const alertRef = useRef<HTMLDivElement>(null);
  const frameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAvailability(getVSCodeAvailability());
  }, []);

  useEffect(() => {
    if (availability !== "available") return;

    let active = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let requestTimer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let attempts = 0;

    const finish = (next: ServiceState) => {
      if (active) setService(next);
    };

    const check = async (): Promise<void> => {
      attempts += 1;
      finish({
        phase: attempts === 1 ? "loading" : "starting",
        detail: attempts === 1 ? null : "VS Code is still starting. Checking again…",
      });

      controller = new AbortController();
      let timedOut = false;
      requestTimer = setTimeout(() => {
        timedOut = true;
        controller?.abort();
      }, VSCODE_STATUS_TIMEOUT_MS);

      try {
        const response = await fetch("/api/v1/services/status", {
          credentials: "same-origin",
          headers: { "x-ingenium-ui": "dashboard" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`VS Code status check failed (HTTP ${response.status})`);

        const state = getVSCodeServiceState(await response.json());
        if (state === "running") {
          finish({ phase: "ready", detail: null });
          return;
        }
        if (state === null) {
          finish({ phase: "missing", detail: "The VS Code process is not reported by the local service supervisor." });
          return;
        }
        if (state === "stopped") {
          finish({ phase: "stopped", detail: "The local VS Code process is stopped." });
          return;
        }
        if (state === "error") {
          finish({ phase: "error", detail: "The local VS Code process reported an error." });
          return;
        }
        if (state !== "starting") {
          finish({ phase: "error", detail: "The local VS Code process reported an unknown state." });
          return;
        }

        if (attempts >= VSCODE_STATUS_MAX_ATTEMPTS) {
          finish({ phase: "starting", detail: "VS Code is still starting after the bounded local status checks." });
          return;
        }
        pollTimer = setTimeout(() => { void check(); }, VSCODE_STATUS_POLL_MS);
      } catch {
        if (!active) return;
        if (attempts >= VSCODE_STATUS_MAX_ATTEMPTS) {
          finish({
            phase: "error",
            detail: timedOut ? "The local VS Code status check timed out." : "The local VS Code status check could not be completed.",
          });
          return;
        }
        pollTimer = setTimeout(() => { void check(); }, VSCODE_STATUS_POLL_MS);
      } finally {
        if (requestTimer !== null) clearTimeout(requestTimer);
        requestTimer = null;
        controller = null;
      }
    };

    void check();
    return () => {
      active = false;
      if (pollTimer !== null) clearTimeout(pollTimer);
      if (requestTimer !== null) clearTimeout(requestTimer);
      controller?.abort();
    };
  }, [availability, retryNonce]);

  const clearFrameTimeout = () => {
    if (frameTimeoutRef.current !== null) {
      clearTimeout(frameTimeoutRef.current);
      frameTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    if (availability !== "available" || service.phase !== "ready" || frameError !== null) return;

    if (frameTimeoutRef.current !== null) clearTimeout(frameTimeoutRef.current);
    frameTimeoutRef.current = setTimeout(() => {
      setFrameError("VS Code did not respond before the local iframe timeout.");
      frameTimeoutRef.current = null;
    }, VSCODE_FRAME_TIMEOUT_MS);

    return () => {
      if (frameTimeoutRef.current !== null) {
        clearTimeout(frameTimeoutRef.current);
        frameTimeoutRef.current = null;
      }
    };
  }, [availability, service.phase, frameError, retryNonce]);

  useEffect(() => {
    if (availability === "unavailable" || ["missing", "stopped", "error"].includes(service.phase) || frameError !== null) {
      alertRef.current?.focus();
    }
  }, [availability, service.phase, frameError]);

  const retry = () => {
    clearFrameTimeout();
    setFrameError(null);
    setService(INITIAL_SERVICE_STATE);
    setRetryNonce((value) => value + 1);
  };

  if (availability === null) {
    return <FrameNotice noticeRef={alertRef} role="status" title="Preparing VS Code" detail="Checking the local dashboard connection…" />;
  }

  if (availability === "unavailable") {
    return (
      <FrameNotice
        noticeRef={alertRef}
        role="alert"
        title="VS Code is unavailable on this connection"
        detail="VS Code embeds only from http://localhost:3000 or http://127.0.0.1:3000."
        onRetry={retry}
      />
    );
  }

  if (service.phase === "loading" || service.phase === "starting") {
    return (
      <FrameNotice
        noticeRef={alertRef}
        role="status"
        title={service.phase === "loading" ? "Checking local VS Code" : "VS Code is starting"}
        detail={service.detail ?? "Checking the exact local VS Code process…"}
        onRetry={service.phase === "starting" && service.detail?.includes("bounded") ? retry : undefined}
      />
    );
  }

  if (service.phase !== "ready" || frameError !== null) {
    const title = frameError !== null
      ? "VS Code could not be loaded"
      : service.phase === "missing"
        ? "VS Code process is missing"
        : service.phase === "stopped"
          ? "VS Code is stopped"
          : "VS Code reported an error";
    return <FrameNotice noticeRef={alertRef} role="alert" title={title} detail={frameError ?? service.detail ?? "VS Code is unavailable."} onRetry={retry} />;
  }

  const src = getVSCodeUrl();
  if (src === null) {
    return <FrameNotice noticeRef={alertRef} role="alert" title="VS Code is unavailable on this connection" detail="The local VS Code origin is not allowed from this dashboard location." onRetry={retry} />;
  }

  // Deliberately unsandboxed: this is the fixed trusted separate-origin local gateway.
  return (
    <iframe
      key={retryNonce}
      src={src}
      title="VS Code"
      allow="clipboard-write"
      loading="eager"
      className="absolute inset-0 h-full w-full border-0"
      onLoad={clearFrameTimeout}
      onError={() => {
        clearFrameTimeout();
        setFrameError("VS Code could not be reached through the local gateway.");
      }}
    />
  );
}
