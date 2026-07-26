"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getApiBase } from "./api";

export type OpenCodeHealthStatus = "starting" | "ready" | "unavailable" | "auth-required";
export type OpenCodeAuthScope = "dashboard" | "opencode" | null;

export interface OpenCodeHealthState {
  status: OpenCodeHealthStatus;
  error: string | null;
  lastChecked: number | null;
  attempts: number;
  /** Which protected boundary rejected the health request, when applicable. */
  authScope: OpenCodeAuthScope;
}

export const OPENCODE_HEALTH_MAX_ATTEMPTS = 3;
export const OPENCODE_HEALTH_POLL_MS = 5_000;
export const OPENCODE_HEALTH_TIMEOUT_MS = 4_000;

/**
 * Bounded health poller for the OpenCode server.
 *
 * The API reports OpenCode startup as 503. Network failures and startup
 * responses are retried a small, fixed number of times; the hook then stops
 * polling and exposes an actionable `unavailable` state. A manual retry starts
 * a fresh bounded attempt window. Requests also have a timeout so a wedged
 * browser connection cannot leave the UI in a permanent loading state.
 */
export function useOpenCodeHealth(): OpenCodeHealthState & { retry: () => void } {
  const [state, setState] = useState<OpenCodeHealthState>({
    status: "starting",
    error: null,
    lastChecked: null,
    attempts: 0,
    authScope: null,
  });
  const mountedRef = useRef(false);
  const statusRef = useRef<OpenCodeHealthStatus>("starting");
  const attemptsRef = useRef(0);
  const inFlightRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  const check = useCallback(async (resetAttempts = false) => {
    if (!mountedRef.current || inFlightRef.current) return;
    if (resetAttempts) attemptsRef.current = 0;

    inFlightRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, OPENCODE_HEALTH_TIMEOUT_MS);

    const update = (next: OpenCodeHealthState) => {
      if (!mountedRef.current) return;
      statusRef.current = next.status;
      setState(next);
    };

    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/opencode/health?project=global-default`, {
        credentials: "same-origin",
        headers: { "x-ingenium-ui": "dashboard" },
        signal: controller.signal,
      });

      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        const healthy = body?.data?.healthy !== false;
        if (healthy) {
          attemptsRef.current = 0;
          update({ status: "ready", error: null, lastChecked: Date.now(), attempts: 0, authScope: null });
        } else {
          recordFailure(attemptsRef, update, "OpenCode reported an unhealthy status");
        }
      } else {
        const body = await res.json().catch(() => ({}));
        const errorCode = typeof body?.error?.code === "string" ? body.error.code : "";
        // The browser is checking the dashboard API, not OpenCode directly.
        // A bare 401/403 therefore represents the dashboard's protected
        // boundary (often an upstream gateway), not OpenCode authentication.
        // The API normalizes upstream OpenCode 401/403 responses to a stable
        // HTTP_401/HTTP_403 error code, which is the only case treated as an
        // OpenCode auth failure here.
        if (/^HTTP_(401|403)$/.test(errorCode)) {
          recordAuthRequired(attemptsRef, update, "opencode");
        } else if (res.status === 401 || res.status === 403 || /UNAUTHORIZED|FORBIDDEN/i.test(errorCode)) {
          recordAuthRequired(attemptsRef, update, "dashboard");
        } else if (errorCode === "OPENCODE_NOT_CONFIGURED") {
          update({
            status: "unavailable",
            error: body?.error?.message ?? "OpenCode is not configured",
            lastChecked: Date.now(),
            attempts: attemptsRef.current,
            authScope: null,
          });
        } else {
          recordFailure(
            attemptsRef,
            update,
            res.status === 503 ? "OpenCode is still starting" : `Health check failed (HTTP ${res.status})`,
          );
        }
      }
    } catch {
      recordFailure(
        attemptsRef,
        update,
        timedOut ? "OpenCode health check timed out" : "Unable to reach OpenCode",
      );
    } finally {
      clearTimeout(timeout);
      inFlightRef.current = false;
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  const retry = useCallback(() => {
    if (!mountedRef.current) return;
    attemptsRef.current = 0;
    statusRef.current = "starting";
    setState({ status: "starting", error: null, lastChecked: null, attempts: 0, authScope: null });
    void check(true);
  }, [check]);

  useEffect(() => {
    mountedRef.current = true;
    void check();
    const interval = setInterval(() => {
      if (statusRef.current !== "unavailable" && statusRef.current !== "auth-required") void check();
    }, OPENCODE_HEALTH_POLL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [check]);

  return { ...state, retry };
}

function recordFailure(
  attemptsRef: { current: number },
  update: (next: OpenCodeHealthState) => void,
  error: string,
): void {
  const attempts = attemptsRef.current + 1;
  attemptsRef.current = attempts;
  const exhausted = attempts >= OPENCODE_HEALTH_MAX_ATTEMPTS;
  update({
    status: exhausted ? "unavailable" : "starting",
    error: exhausted ? error : null,
    lastChecked: Date.now(),
    attempts,
    authScope: null,
  });
}

function recordAuthRequired(
  attemptsRef: { current: number },
  update: (next: OpenCodeHealthState) => void,
  scope: Exclude<OpenCodeAuthScope, null>,
): void {
  update({
    status: "auth-required",
    error: scope === "dashboard"
      ? "Dashboard authentication is required to check OpenCode health"
      : "OpenCode gateway authentication is required",
    lastChecked: Date.now(),
    attempts: attemptsRef.current,
    authScope: scope,
  });
}
