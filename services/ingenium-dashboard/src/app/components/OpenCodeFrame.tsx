"use client";

import { useRef, useEffect, useState } from "react";
import { useRuntimeLaunch, useRuntimeWorkspace } from "@/lib/use-runtime-launch";
import RuntimeWorkspacePicker from "./RuntimeWorkspacePicker";

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
 * Audience launch gating redeems a one-time ticket before either runtime root
 * is mounted. The browser receives no backend address or API capability.
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
  const [frameError, setFrameError] = useState<{ mode: "web" | "cli"; message: string } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const workspace = useRuntimeWorkspace();
  const webLaunch = useRuntimeLaunch("web", workspace);
  const cliLaunch = useRuntimeLaunch("cli", workspace, cliMounted);
  const activeLaunch = mode === "web" ? webLaunch : cliLaunch;
  const activeUrl = activeLaunch.url;
  const activeFrameError = frameError?.mode === mode ? frameError.message : null;
  const canRenderFrame = activeLaunch.status === "ready" && activeUrl !== null && activeFrameError === null;

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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
  }, [activeUrl, canRenderFrame, mode, retryNonce]);

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
    setRetryNonce((value) => value + 1);
    activeLaunch.retry();
  };

  if (workspace.status !== "ready") {
    return <RuntimeWorkspacePicker controller={workspace} product={mode === "web" ? "OpenCode Web" : "OpenCode CLI"} />;
  }

  if (activeLaunch.status === "loading" || activeLaunch.status === "starting") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        <div className="max-w-md text-center px-6" role="status" aria-live="polite">
          <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Preparing your isolated {mode === "web" ? "OpenCode" : "terminal"} workspace…</p>
          <p className="text-gray-500 text-xs mt-2">{activeLaunch.error ?? "Allocating the audience-specific runtime session."}</p>
        </div>
      </div>
    );
  }

  if (activeLaunch.status === "unavailable" || activeLaunch.status === "expired") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        <div className="max-w-md text-center px-6" role="alert">
          <h2 className="text-white text-lg font-semibold mb-2">
            {activeLaunch.status === "expired" ? "Workspace launch expired" : "Workspace is unavailable"}
          </h2>
          <p className="text-gray-400 text-sm mb-4">{activeLaunch.error}</p>
          <div className="flex items-center justify-center gap-4 text-sm">
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
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        <div className="max-w-md text-center px-6" role="alert">
          <h2 className="text-white text-lg font-semibold mb-2">OpenCode could not be loaded</h2>
          <p className="text-gray-400 text-sm mb-4">{activeFrameError}</p>
          <div className="flex items-center justify-center gap-4 text-sm">
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
      {webLaunch.url !== null && (
        <iframe
          key={`web-${retryNonce}`}
          src={webLaunch.url}
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
      {cliMounted && cliLaunch.url !== null && (
        <iframe
          key={`cli-${retryNonce}`}
          src={cliLaunch.url}
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
