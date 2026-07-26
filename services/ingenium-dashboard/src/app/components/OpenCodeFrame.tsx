"use client";

import { useRef, useEffect, useState } from "react";
import {
  getOpenCodeWebUrl,
  getOpenCodeCliUrl,
  getOpenCodeAvailability,
  getOpenCodeAuthUrl,
  type OpenCodeAvailability,
} from "@/lib/runtime-urls";
import { useOpenCodeHealth } from "@/lib/use-opencode-health";

interface OpenCodeFrameProps {
  mode: "web" | "cli";
  cliMounted: boolean;
  onWebLoaded?: () => void;
  onCliLoaded?: () => void;
}

/**
 * Renders two stable, full-size iframes for OpenCode Web and CLI modes.
 *
 * Both iframes stay at full viewport dimensions in the DOM at all times
 * (once mounted). Inactive iframes are hidden via opacity/visibility/pointer-events
 * instead of display:none to prevent xterm dimension zeroing on the CLI side.
 *
 * A ResizeObserver monitors the container and sets CSS custom properties
 * (--iframe-width / --iframe-height) so ttyd/OpenCode always receives
 * stable, non-zero dimensions even during layout transitions.
 *
 * Health gating via useOpenCodeHealth prevents embedding before OpenCode
 * is ready. Availability gating via getOpenCodeAvailability prevents
 * embedding on unsupported LAN/HTTPS connections. No iframe is mounted until
 * both checks have completed and the active mode has a validated URL.
 */
export default function OpenCodeFrame({
  mode,
  cliMounted,
  onWebLoaded,
  onCliLoaded,
}: OpenCodeFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [runtime, setRuntime] = useState<{
    web: string | null;
    cli: string | null;
    availability: { web: OpenCodeAvailability; cli: OpenCodeAvailability };
  } | null>(null);
  const [frameError, setFrameError] = useState<{ mode: "web" | "cli"; message: string } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const {
    status: healthStatus,
    error: healthError,
    authScope,
    retry: retryHealth,
  } = useOpenCodeHealth();

  const activeUrl = runtime === null ? null : mode === "web" ? runtime.web : runtime.cli;
  const activeFrameError = frameError?.mode === mode ? frameError.message : null;
  const canRenderFrame = healthStatus === "ready" && runtime !== null && activeUrl !== null && activeFrameError === null;

  // Resolve runtime URLs and availability after hydration — never during render.
  useEffect(() => {
    setRuntime({
      web: getOpenCodeWebUrl(),
      cli: getOpenCodeCliUrl(),
      availability: {
        web: getOpenCodeAvailability("web"),
        cli: getOpenCodeAvailability("cli"),
      },
    });
  }, []);

  // Observe container size changes to provide stable dimensions to ttyd / OpenCode
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !canRenderFrame || typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        // Set CSS custom properties so iframes' children can read stable dimensions
        // even during layout transitions that would otherwise report 0.
        el.style.setProperty("--iframe-width", `${Math.round(width)}px`);
        el.style.setProperty("--iframe-height", `${Math.round(height)}px`);
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [canRenderFrame]);

  // Give a mounted iframe a bounded amount of time to report reachability.
  // `onLoad` clears this timer; a timeout removes the iframe rather than
  // leaving a blank surface when a gateway is down or blocked by the browser.
  useEffect(() => {
    if (!canRenderFrame || activeUrl === null) return;

    if (loadTimeoutRef.current !== null) clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = setTimeout(() => {
      if (modeRef.current === mode) {
        setFrameError({ mode, message: "OpenCode did not respond in time" });
      }
      loadTimeoutRef.current = null;
    }, 15_000);

    return () => {
      if (loadTimeoutRef.current !== null) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
    };
  }, [activeUrl, canRenderFrame, retryNonce]);

  const clearLoadTimeout = () => {
    if (loadTimeoutRef.current !== null) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  };

  const handleFrameLoad = (frameMode: "web" | "cli", onLoaded?: () => void) => {
    // An inactive frame can finish loading after the active frame has failed.
    // It must never clear the active frame's error surface or its timeout.
    if (frameMode !== modeRef.current) {
      onLoaded?.();
      return;
    }
    clearLoadTimeout();
    setFrameError((current) => current?.mode === frameMode ? null : current);
    onLoaded?.();
  };

  const handleFrameError = (frameMode: "web" | "cli") => {
    if (frameMode !== modeRef.current) return;
    clearLoadTimeout();
    setFrameError({ mode: frameMode, message: "OpenCode could not be reached" });
  };

  const handleRetry = () => {
    clearLoadTimeout();
    setFrameError(null);
    setRuntime(null);
    setRetryNonce((value) => value + 1);
    retryHealth();
  };

  // Health is checked first so the SSR tree and first client tree both contain
  // a status surface, never an iframe with an empty src.
  if (healthStatus === "starting") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        <div className="max-w-md text-center px-6" role="status" aria-live="polite">
          <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-400 text-sm">OpenCode is starting up…</p>
          <p className="text-gray-500 text-xs mt-2">The dashboard will retry a limited number of times.</p>
        </div>
      </div>
    );
  }

  if (healthStatus === "auth-required") {
    const authUrl = getOpenCodeAuthUrl(mode);
    const dashboardAuth = authScope === "dashboard";
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        <div className="max-w-md text-center px-6" role="alert">
          <h2 className="text-white text-lg font-semibold mb-2">
            {dashboardAuth ? "Dashboard authentication required" : "OpenCode authentication required"}
          </h2>
          <p className="text-gray-400 text-sm mb-4">
            {dashboardAuth
              ? "Authenticate with the dashboard gateway, then retry this view."
              : healthError ?? "Authenticate with the protected OpenCode gateway, then retry this view."}
          </p>
          <div className="flex items-center justify-center gap-4 text-sm">
            <a
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              {dashboardAuth ? "Open gateway sign-in" : "Open OpenCode sign-in"}
            </a>
            <button
              type="button"
              onClick={handleRetry}
              className="text-blue-400 hover:text-blue-300 underline"
            >
              Retry connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (healthStatus === "unavailable") {
    const authUrl = getOpenCodeAuthUrl(mode);
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        <div className="max-w-md text-center px-6" role="alert">
          <h2 className="text-white text-lg font-semibold mb-2">OpenCode is unavailable</h2>
          <p className="text-gray-400 text-sm mb-4">{healthError ?? "OpenCode could not be reached."}</p>
          <div className="flex items-center justify-center gap-4 text-sm">
            <a
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              Open gateway sign-in
            </a>
            <button
              type="button"
              onClick={handleRetry}
              className="text-blue-400 hover:text-blue-300 underline"
            >
              Retry connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (runtime === null) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        <div className="text-center" role="status" aria-live="polite">
          <p className="text-gray-400 text-sm">Preparing OpenCode…</p>
        </div>
      </div>
    );
  }

  // ── Availability guard ──────────────────────────────────────────────
  const activeAvailability = runtime.availability[mode];
  if (activeAvailability === "unavailable" || activeUrl === null) {
    const authUrl = getOpenCodeAuthUrl(mode);
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        <div className="max-w-md text-center px-6" role="alert">
          <h2 className="text-white text-lg font-semibold mb-2">OpenCode cannot be embedded on this connection</h2>
          <p className="text-gray-400 text-sm mb-4">
            OpenCode serves root-relative assets and cannot be proxied under a shared origin.
            Configure the validated host gateway roots or a dedicated HTTPS origin, or access the dashboard
            from http://localhost:3000.
          </p>
          <div className="flex items-center justify-center gap-4 text-sm">
            <a
              role="button"
              aria-label="Open OpenCode in a new tab"
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                event.preventDefault();
                window.open(authUrl, "_blank", "noopener,noreferrer");
              }}
              className="text-blue-400 hover:text-blue-300 underline"
            >
              Open authenticated OpenCode gateway
            </a>
            <button
              type="button"
              onClick={handleRetry}
              className="text-blue-400 hover:text-blue-300 underline"
            >
              Retry connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activeFrameError !== null) {
    const authUrl = getOpenCodeAuthUrl(mode);
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        <div className="max-w-md text-center px-6" role="alert">
          <h2 className="text-white text-lg font-semibold mb-2">OpenCode could not be loaded</h2>
          <p className="text-gray-400 text-sm mb-4">{activeFrameError}</p>
          <div className="flex items-center justify-center gap-4 text-sm">
            <a
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              Open gateway sign-in
            </a>
            <button
              type="button"
              onClick={handleRetry}
              className="text-blue-400 hover:text-blue-300 underline"
            >
              Retry connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Web iframe — mounted only after its validated URL is available. */}
      {runtime.web !== null && (
        <iframe
          key={`web-${retryNonce}`}
          src={runtime.web}
          className="absolute inset-0 w-full h-full border-0"
          style={{
            opacity: mode === "web" ? 1 : 0,
            visibility: mode === "web" ? "visible" : "hidden",
            pointerEvents: mode === "web" ? "auto" : "none",
          }}
          aria-hidden={mode !== "web"}
          tabIndex={mode === "web" ? 0 : -1}
          title="OpenCode Web"
          allow="clipboard-write"
          onLoad={() => handleFrameLoad("web", onWebLoaded)}
          onError={() => handleFrameError("web")}
        />
      )}

      {/* CLI iframe — lazy-mounted on first CLI activation. */}
      {cliMounted && runtime.cli !== null && (
        <iframe
          key={`cli-${retryNonce}`}
          src={runtime.cli}
          className="absolute inset-0 w-full h-full border-0"
          style={{
            opacity: mode === "cli" ? 1 : 0,
            visibility: mode === "cli" ? "visible" : "hidden",
            pointerEvents: mode === "cli" ? "auto" : "none",
          }}
          aria-hidden={mode !== "cli"}
          tabIndex={mode === "cli" ? 0 : -1}
          title="OpenCode Terminal"
          allow="clipboard-write"
          onLoad={() => handleFrameLoad("cli", onCliLoaded)}
          onError={() => handleFrameError("cli")}
        />
      )}
    </div>
  );
}
