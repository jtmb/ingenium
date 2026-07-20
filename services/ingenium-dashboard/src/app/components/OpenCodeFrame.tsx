"use client";

import { useRef, useEffect, useState } from "react";
import { getOpenCodeWebUrl, getOpenCodeCliUrl, getOpenCodeAvailability } from "@/lib/runtime-urls";
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
 * embedding on unsupported LAN/HTTPS connections.
 */
export default function OpenCodeFrame({
  mode,
  cliMounted,
  onWebLoaded,
  onCliLoaded,
}: OpenCodeFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [iframeUrls, setIframeUrls] = useState<{ web: string | null; cli: string | null } | null>(null);
  const { status: healthStatus } = useOpenCodeHealth();
  const availability = getOpenCodeAvailability();

  // Resolve after hydration so loopback clients never first navigate to the SSR proxy URL.
  useEffect(() => {
    setIframeUrls({ web: getOpenCodeWebUrl(), cli: getOpenCodeCliUrl() });
  }, []);

  // Observe container size changes to provide stable dimensions to ttyd / OpenCode
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

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
  }, []);

  // ── Availability guard ──────────────────────────────────────────────
  if (availability === "unavailable") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        <div className="max-w-md text-center px-6">
          <h2 className="text-white text-lg font-semibold mb-2">OpenCode cannot be embedded on this connection</h2>
          <p className="text-gray-400 text-sm mb-4">
            OpenCode serves root-relative assets and cannot be proxied under a shared origin.
            Set NEXT_PUBLIC_OPENCODE_WEB_URL to a dedicated HTTPS origin, or access the dashboard
            from http://localhost:3000.
          </p>
          <button onClick={() => window.open("http://localhost:4098", "_blank")}
            className="text-sm text-blue-400 hover:text-blue-300 underline">
            Open OpenCode in a new tab
          </button>
        </div>
      </div>
    );
  }

  // ── Health guard ────────────────────────────────────────────────────
  if (healthStatus === "starting") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-400 text-sm">OpenCode is starting up…</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Web iframe — always mounted */}
      <iframe
        src={iframeUrls?.web ?? undefined}
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
        onLoad={onWebLoaded}
      />

      {/* CLI iframe — lazy-mounted on first CLI activation */}
      {cliMounted && (
        <iframe
          src={iframeUrls?.cli ?? undefined}
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
          onLoad={onCliLoaded}
        />
      )}
    </div>
  );
}
