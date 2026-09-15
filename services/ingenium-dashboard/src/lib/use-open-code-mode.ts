"use client";

import { useCallback, useEffect, useState } from "react";
import { parseOpenCodeMode, type OpenCodeMode } from "./open-code-mode";

const STORAGE_KEY = "opencode-mode";

function replaceModeInUrl(mode: OpenCodeMode): void {
  const url = new URL(window.location.href);
  if (url.searchParams.getAll("mode").length === 1 && url.searchParams.get("mode") === mode) return;
  url.searchParams.set("mode", mode);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function useOpenCodeMode(initialMode: OpenCodeMode, restoreStoredMode: boolean) {
  const [mode, setMode] = useState<OpenCodeMode>(initialMode);
  const [cliMounted, setCliMounted] = useState(initialMode === "cli");

  useEffect(() => {
    let resolvedMode = initialMode;
    if (restoreStoredMode) {
      try {
        resolvedMode = parseOpenCodeMode(localStorage.getItem(STORAGE_KEY));
      } catch {
        resolvedMode = "web";
      }
      // Browser preferences are unavailable during SSR, so the stored fallback resolves after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode(resolvedMode);
      if (resolvedMode === "cli") setCliMounted(true);
    }

    try { localStorage.setItem(STORAGE_KEY, resolvedMode); } catch { /* Preference storage is optional. */ }
    replaceModeInUrl(resolvedMode);
  }, [initialMode, restoreStoredMode]);

  const changeMode = useCallback((newMode: OpenCodeMode) => {
    setMode(newMode);
    if (newMode === "cli") setCliMounted(true);
    try { localStorage.setItem(STORAGE_KEY, newMode); } catch { /* Preference storage is optional. */ }
    replaceModeInUrl(newMode);
  }, []);

  return { mode, cliMounted, changeMode };
}
