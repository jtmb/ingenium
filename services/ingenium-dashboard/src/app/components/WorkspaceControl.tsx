"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";

export interface WorkspaceControlProps {
  /** Current page identifier for state encoding in popout URL */
  pageId: "opencode" | "mail" | "docs";
  /** Optional state params to encode in popout URL (e.g., account, folder, messageId for mail) */
  stateParams?: Record<string, string>;
  /** Extra controls to render alongside the standard ones */
  children?: ReactNode;
}

/**
 * Shared fullscreen/pop-out control bar.
 *
 * Renders compact icon buttons for:
 * - Fullscreen toggle (hidden when API unavailable, e.g. iOS)
 * - Pop-out to standalone window
 * - Return/close (only when in standalone mode)
 *
 * Detects standalone mode by checking `window.opener` or
 * `?standalone=1` in the URL search params.
 */
export default function WorkspaceControl({
  pageId,
  stateParams,
  children,
}: WorkspaceControlProps) {
  // ── Fullscreen state ────────────────────────────────────────────────
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    // Check fullscreen API availability at mount (iOS Safari doesn't support it)
    if (typeof document === "undefined") return;
    setFullscreenAvailable(
      !!document.documentElement.requestFullscreen &&
        !!document.exitFullscreen,
    );

    // Track fullscreen state changes from keyboard (F11) or other triggers
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const handleFullscreen = useCallback(() => {
    if (isFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, [isFullscreen]);

  // ── Pop-out ─────────────────────────────────────────────────────────
  /** Build the standalone URL with current page + state parameters encoded in the query string. */
  const buildPopoutUrl = useCallback(() => {
    const params = new URLSearchParams();
    params.set("page", pageId);
    params.set("standalone", "1");
    if (stateParams) {
      for (const [key, value] of Object.entries(stateParams)) {
        params.set(key, value);
      }
    }
    return `/standalone?${params.toString()}`;
  }, [pageId, stateParams]);

  const handlePopout = useCallback(() => {
    const url = buildPopoutUrl();
    const popup = window.open(
      url,
      "_blank",
      "width=1280,height=900,noopener",
    );
    if (!popup) {
      // window.open returns null when blocked by a pop-up blocker
      setToast("Pop-up blocked. Please allow pop-ups for this site.");
      setTimeout(() => setToast(null), 4000);
    }
  }, [buildPopoutUrl]);

  // ── Standalone detection ────────────────────────────────────────────
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Two detection mechanisms: window.opener (popup opened by script)
    // and ?standalone=1 URL param (direct navigation to /standalone)
    if (window.opener) {
      setIsStandalone(true);
      return;
    }
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("standalone") === "1") setIsStandalone(true);
    } catch {
      // ignore
    }
  }, []);

  /**
   * Close the standalone window.
   *
   * `window.close()` only works on windows opened by `window.open()`.
   * If it fails (e.g. direct navigation), we navigate to "/" as fallback.
   */
  const handleReturn = useCallback(() => {
    try {
      window.close();
    } catch {
      // window.close() only works on windows opened by script
      // Fall back to navigation
      window.location.href = "/";
    }
  }, []);

  // ── SVG icons ───────────────────────────────────────────────────────
  const FullscreenEnterIcon = (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
    </svg>
  );

  const FullscreenExitIcon = (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
    </svg>
  );

  const PopoutIcon = (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );

  const ReturnIcon = (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M6 18L18 6M6 6l12 12" />
    </svg>
  );

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="relative">
      <div className="flex items-center gap-1 shrink-0">
        {/* Extra controls slot */}
        {children}

        {/* Fullscreen toggle */}
        {fullscreenAvailable && (
          <button
            onClick={handleFullscreen}
            className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? FullscreenExitIcon : FullscreenEnterIcon}
          </button>
        )}

        {/* Pop-out */}
        <button
          onClick={handlePopout}
          className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
          title="Pop out"
          aria-label="Pop out to standalone window"
        >
          {PopoutIcon}
        </button>

        {/* Return/close — standalone mode only */}
        {isStandalone && (
          <button
            onClick={handleReturn}
            className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            title="Close and return"
            aria-label="Close and return"
          >
            {ReturnIcon}
          </button>
        )}
      </div>

      {/* Toast for blocked pop-ups */}
      {toast && (
        <div
          className="absolute right-0 mt-2 z-50 px-4 py-2 bg-red-600 text-white text-sm rounded shadow-lg whitespace-nowrap animate-pulse"
          role="alert"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
