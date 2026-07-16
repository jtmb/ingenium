"use client";

import { useState, useEffect, useCallback } from "react";
import OpenCodeFrame from "../components/OpenCodeFrame";
import OpenCodeToolbar from "../components/OpenCodeToolbar";

/**
 * OpenCode page — edge-to-edge dual-mode (Web/CLI) interface.
 *
 * Both iframes persist in the DOM after first mount. The inactive iframe
 * is hidden via opacity/visibility/pointer-events instead of display:none
 * to prevent xterm dimension zeroing on the CLI side.
 *
 * The integrated toolbar replaces the old floating glass OpenCodeSwitch tab.
 */
export default function OpenCodePage() {
  const [mode, setMode] = useState<"web" | "cli">("web");
  const [cliMounted, setCliMounted] = useState(false);
  const [webLoaded, setWebLoaded] = useState(false);
  const [cliLoaded, setCliLoaded] = useState(false);

  // Load persisted mode from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("opencode-mode");
      if (saved === "cli" || saved === "web") {
        setMode(saved);
      }
    } catch {
      // localStorage may be unavailable (SSR, incognito, etc.)
    }
  }, []);

  // Lazy-mount CLI iframe on first CLI activation; persist mode choice
  const handleModeChange = useCallback(
    (newMode: "web" | "cli") => {
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

  // Status indicator shows loaded state of the active iframe
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
