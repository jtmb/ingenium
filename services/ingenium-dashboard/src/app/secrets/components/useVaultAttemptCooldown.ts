"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../../lib/api";

const DEFAULT_RETRY_AFTER_SECONDS = 5;

/**
 * Honors the server's Retry-After header for passphrase attempts. The hook
 * deliberately never performs an automatic retry: an unlock or initialization
 * attempt always requires a fresh user action after the countdown ends.
 */
export function useVaultAttemptCooldown() {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  const hasNoCooldown = remainingSeconds === null;

  useEffect(() => {
    if (hasNoCooldown) return;

    const timer = window.setInterval(() => {
      setRemainingSeconds((current) => {
        if (current === null || current <= 1) return null;
        return current - 1;
      });
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [hasNoCooldown]);

  const startCooldownFor = useCallback((error: unknown): boolean => {
    if (!(error instanceof ApiError) || error.status !== 429) return false;
    setRemainingSeconds(Math.max(1, error.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS));
    return true;
  }, []);

  return {
    remainingSeconds,
    isCoolingDown: remainingSeconds !== null,
    startCooldownFor,
  };
}
