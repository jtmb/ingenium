"use client";

import { useEffect, useRef } from "react";

interface OpenCodeToolbarProps {
  mode: "web" | "cli";
  onModeChange: (newMode: "web" | "cli") => void;
  isLoaded: boolean;
}

/**
 * Compact integrated toolbar at the top of the OpenCode viewport.
 *
 * Contains a segmented Web/CLI toggle, fullscreen button, pop-out button,
 * and a status indicator (green=loaded, red=loading). Replaces the old
 * floating glass OpenCodeSwitch tab.
 *
 * Keyboard shortcut: Ctrl+Shift+` toggles Web/CLI mode.
 */
export default function OpenCodeToolbar({
  mode,
  onModeChange,
  isLoaded,
}: OpenCodeToolbarProps) {
  /**
   * Refs to avoid stale closures in the keyboard shortcut listener.
   *
   * The `useEffect` with `[]` deps only runs once, so the callback would
   * capture the initial values of `mode` and `onModeChange`. Using refs
   * ensures the handler always reads the latest values without re-registering
   * the listener on every render.
   */
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;

  // Global keyboard shortcut: Ctrl+Shift+` — registered once, reads refs for current values
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === "Backquote") {
        e.preventDefault();
        const next = modeRef.current === "web" ? "cli" : "web";
        onModeChangeRef.current(next);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleFullscreen = () => {
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
    } catch {
      // Fullscreen API may not be available
    }
  };

  const handlePopOut = () => {
    window.open(
      "/standalone?page=opencode",
      "_blank",
      "width=1280,height=900,noopener"
    );
  };

  return (
    <div className="flex items-center justify-between px-3 h-9 bg-[var(--color-surface)] border-b border-[var(--color-border)] shrink-0 select-none">
      {/* Left: Segmented Web/CLI toggle */}
      <div className="flex items-center">
        <div className="flex rounded-md border border-[var(--color-border)] overflow-hidden">
          <button
            type="button"
            role="button"
            onClick={() => onModeChange("web")}
            className={[
              "px-3 py-1 text-xs font-medium transition-colors",
              mode === "web"
                ? "bg-[var(--color-selection-bg)] text-[var(--color-selection-text)]"
                : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]",
            ].join(" ")}
            aria-pressed={mode === "web"}
            aria-label="Switch to Web mode"
          >
            Web
          </button>
          <button
            type="button"
            role="button"
            onClick={() => onModeChange("cli")}
            className={[
              "px-3 py-1 text-xs font-medium transition-colors border-l border-[var(--color-border)]",
              mode === "cli"
                ? "bg-[var(--color-selection-bg)] text-[var(--color-selection-text)]"
                : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]",
            ].join(" ")}
            aria-pressed={mode === "cli"}
            aria-label="Switch to CLI mode"
          >
            CLI
          </button>
        </div>
      </div>

      {/* Right: Action buttons + status */}
      <div className="flex items-center gap-2">
        {/* Fullscreen */}
        <button
          type="button"
          onClick={handleFullscreen}
          title="Toggle fullscreen"
          className="p-1 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          aria-label="Toggle fullscreen"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
        </button>

        {/* Pop-out */}
        <button
          type="button"
          onClick={handlePopOut}
          title="Pop out to new window"
          className="p-1 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          aria-label="Pop out to new window"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </button>

        {/* Status indicator — green when loaded, red when loading */}
        <span
          title={isLoaded ? "Connected" : "Loading..."}
          className={[
            "w-2 h-2 rounded-full shrink-0 transition-colors duration-300",
            isLoaded ? "bg-green-500" : "bg-red-500",
          ].join(" ")}
          aria-label={isLoaded ? "OpenCode connected" : "OpenCode loading"}
        />
      </div>
    </div>
  );
}
