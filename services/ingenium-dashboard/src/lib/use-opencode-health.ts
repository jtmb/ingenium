"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getApiBase } from "./api";

export type OpenCodeHealthStatus = "starting" | "ready" | "unavailable";

interface OpenCodeHealthState {
  status: OpenCodeHealthStatus;
  error: string | null;
  lastChecked: number | null;
}

/**
 * Bounded health poller for the OpenCode server.
 * Returns "starting" until first success, "ready" when healthy, "unavailable" on persistent failure.
 */
export function useOpenCodeHealth(): OpenCodeHealthState & { retry: () => void } {
  const [state, setState] = useState<OpenCodeHealthState>({
    status: "starting",
    error: null,
    lastChecked: null,
  });
  const mountedRef = useRef(true);

  const check = useCallback(async () => {
    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/opencode/health?project=global-default`);
      if (!mountedRef.current) return;
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        const healthy = body?.data?.healthy !== false;
        setState({ status: healthy ? "ready" : "unavailable", error: null, lastChecked: Date.now() });
      } else if (res.status === 503) {
        setState({ status: "starting", error: null, lastChecked: Date.now() });
      } else {
        setState({ status: "unavailable", error: `HTTP ${res.status}`, lastChecked: Date.now() });
      }
    } catch {
      if (!mountedRef.current) return;
      setState({ status: "starting", error: null, lastChecked: Date.now() });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    check(); // immediate first check
    const interval = setInterval(check, 5000); // poll every 5s
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [check]);

  return { ...state, retry: check };
}
