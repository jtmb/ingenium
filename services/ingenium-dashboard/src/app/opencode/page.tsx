"use client";

import { useState, useEffect } from "react";
import OpenCodeFrame from "../components/OpenCodeFrame";
import OpenCodeSwitch from "../components/OpenCodeSwitch";

/**
 * OpenCode page with Web/CLI dual-mode toggle.
 *
 * Both iframes are kept in the DOM at full viewport dimensions.
 * The inactive iframe is hidden via opacity/visibility/pointer-events
 * instead of display:none to prevent xterm dimension zeroing.
 * CLI iframe is lazy-mounted on first activation.
 */
export default function OpenCodePage() {
  const [mode, setMode] = useState<"web" | "cli">("web");
  const [cliMounted, setCliMounted] = useState(false);

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
  const handleModeChange = (newMode: "web" | "cli") => {
    setMode(newMode);
    try {
      localStorage.setItem("opencode-mode", newMode);
    } catch {
      // Silently ignore localStorage failures
    }
    if (newMode === "cli" && !cliMounted) {
      setCliMounted(true);
    }
  };

  return (
    <>
      <OpenCodeFrame mode={mode} cliMounted={cliMounted} />
      <OpenCodeSwitch mode={mode} onModeChange={handleModeChange} />
    </>
  );
}
