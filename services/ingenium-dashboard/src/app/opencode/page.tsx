"use client";

import { useState, useEffect, useCallback } from "react";
import OpenCodeFrame from "../components/OpenCodeFrame";
import OpenCodeToolbar from "../components/OpenCodeToolbar";

type OpenCodeMode = "web" | "cli";

/**
 * OpenCode page — dual-mode interface: Web, CLI.
 *
 * Renders iframe-based OpenCode interface with toolbar. Both iframes
 * persist in the DOM after first mount. The inactive iframe is hidden via
 * opacity/visibility/pointer-events instead of display:none to prevent
 * xterm dimension zeroing on the CLI side.
 *
 * Mode is persisted to localStorage under the `opencode-mode` key.
 * The legacy "chat" value is gracefully redirected to "web" since Chat
 * is now a standalone page at /chat.
 */
export default function OpenCodePage() {
  const [mode, setMode] = useState<OpenCodeMode>("web");
  const [cliMounted, setCliMounted] = useState(false);
  const [webLoaded, setWebLoaded] = useState(false);
  const [cliLoaded, setCliLoaded] = useState(false);

  // Load persisted mode from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("opencode-mode");
      if (saved === "cli") {
        setMode("cli");
      }
      // "chat" and any other value fall back to "web" (default)
    } catch {
      // localStorage may be unavailable (SSR, incognito, etc.)
    }
  }, []);

  // Persist mode choice; lazy-mount CLI iframe on first CLI activation
  const handleModeChange = useCallback(
    (newMode: OpenCodeMode) => {
      setMode(newMode);
      try {
        localStorage.setItem("opencode-mode", newMode);
      } catch {
        // Silently ignore localStorage failures
      }
      if (newMode === "cli" && !cliMounted) {
        setCliMounted(true);
      }
    },
    [cliMounted],
  );

  const isLoaded = mode === "web" ? webLoaded : cliLoaded;

  return (
    <div className="flex flex-col h-full min-h-0">
      <OpenCodeToolbar
        mode={mode}
        onModeChange={handleModeChange}
        isLoaded={isLoaded}
      />
      <div className="flex-1 relative bg-black">
        <OpenCodeFrame
          mode={mode}
          cliMounted={cliMounted}
          onWebLoaded={() => setWebLoaded(true)}
          onCliLoaded={() => setCliLoaded(true)}
        />
      </div>
    </div>
  );
}
