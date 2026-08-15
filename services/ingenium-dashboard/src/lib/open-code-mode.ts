"use client";

import { useCallback, useEffect, useState } from "react";

export type OpenCodeMode = "web" | "cli";

const STORAGE_KEY = "opencode-mode";

export function parseOpenCodeMode(value: string | null | undefined): OpenCodeMode {
  return value === "cli" ? "cli" : "web";
}

function replaceModeInUrl(mode: OpenCodeMode): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get("mode") === mode) return;
  url.searchParams.set("mode", mode);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function useOpenCodeMode(modeParam: string | null) {
  const initialMode = modeParam === null ? "web" : parseOpenCodeMode(modeParam);
  const [mode, setMode] = useState<OpenCodeMode>(initialMode);
  const [cliMounted, setCliMounted] = useState(initialMode === "cli");

  useEffect(() => {
    let resolvedMode = parseOpenCodeMode(modeParam);
    if (modeParam === null) {
      try {
        resolvedMode = parseOpenCodeMode(localStorage.getItem(STORAGE_KEY));
      } catch {
        resolvedMode = "web";
      }
    }

    // Browser preferences are unavailable during SSR, so the stored fallback resolves after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(resolvedMode);
    if (resolvedMode === "cli") setCliMounted(true);
    try { localStorage.setItem(STORAGE_KEY, resolvedMode); } catch { /* Preference storage is optional. */ }
    replaceModeInUrl(resolvedMode);
  }, [modeParam]);

  const changeMode = useCallback((newMode: OpenCodeMode) => {
    setMode(newMode);
    if (newMode === "cli") setCliMounted(true);
    try { localStorage.setItem(STORAGE_KEY, newMode); } catch { /* Preference storage is optional. */ }
    replaceModeInUrl(newMode);
  }, []);

  return { mode, cliMounted, changeMode };
}
