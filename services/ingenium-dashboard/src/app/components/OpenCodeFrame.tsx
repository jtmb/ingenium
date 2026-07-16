"use client";

import { useRef, useEffect } from "react";

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
 */
export default function OpenCodeFrame({
  mode,
  cliMounted,
  onWebLoaded,
  onCliLoaded,
}: OpenCodeFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Web iframe — always mounted */}
      <iframe
        src="http://localhost:4098/"
        className="absolute inset-0 w-full h-full border-0"
        style={{
          opacity: mode === "web" ? 1 : 0,
          visibility: mode === "web" ? "visible" : "hidden",
          pointerEvents: mode === "web" ? "auto" : "none",
        }}
        aria-hidden={mode !== "web"}
        tabIndex={mode === "web" ? 0 : -1}
        title="OpenCode Web"
        sandbox="allow-scripts allow-same-origin"
        allow="clipboard-write"
        onLoad={onWebLoaded}
      />

      {/* CLI iframe — lazy-mounted on first CLI activation */}
      {cliMounted && (
        <iframe
          src="http://localhost:4099/"
          className="absolute inset-0 w-full h-full border-0"
          style={{
            opacity: mode === "cli" ? 1 : 0,
            visibility: mode === "cli" ? "visible" : "hidden",
            pointerEvents: mode === "cli" ? "auto" : "none",
          }}
          aria-hidden={mode !== "cli"}
          tabIndex={mode === "cli" ? 0 : -1}
          title="OpenCode Terminal"
          sandbox="allow-scripts allow-same-origin"
          allow="clipboard-write"
          onLoad={onCliLoaded}
        />
      )}
    </div>
  );
}
