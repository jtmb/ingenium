"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, request } from "./api";

export type RuntimeAudience = "web" | "cli" | "vscode";
export type RuntimeLaunchStatus = "loading" | "starting" | "ready" | "expired" | "unavailable";

type RuntimeStatus = {
  status: "ready" | "starting" | "unavailable";
};
type RuntimeLaunch = {
  launchUrl: string;
  status: "ready";
};

function createExchangeProof(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function useRuntimeLaunch(audience: RuntimeAudience, enabled = true) {
  const [status, setStatus] = useState<RuntimeLaunchStatus>("loading");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => {
    setStatus("loading");
    setUrl(null);
    setError(null);
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const launch = async () => {
      try {
        const runtime = await request<{ data: RuntimeStatus }>("/runtimes/browser/status");
        if (!active) return;
        if (runtime.data.status !== "ready") {
          setStatus(runtime.data.status);
          setError(runtime.data.status === "starting" ? "Your isolated workspace is still starting." : "No ready isolated workspace is available.");
          return;
        }
        const exchangeProof = createExchangeProof();
        const launched = await request<{ data: RuntimeLaunch }>("/runtimes/browser/launch", {
          method: "POST",
          body: JSON.stringify({ audience, exchangeProof }),
        });
        const exchange = await fetch(launched.data.launchUrl, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proof: exchangeProof }),
        });
        if (!active) return;
        if (!exchange.ok) {
          setStatus(exchange.status === 401 ? "expired" : "unavailable");
          setError(exchange.status === 401 ? "The launch ticket expired before it could be redeemed." : "The runtime gateway is unavailable.");
          return;
        }
        setUrl(`${new URL(launched.data.launchUrl).origin}/`);
        setStatus("ready");
      } catch (failure) {
        if (!active) return;
        setStatus(failure instanceof ApiError && failure.status === 401 ? "expired" : "unavailable");
        setError(failure instanceof ApiError && failure.status === 401
          ? "Your dashboard session expired. Sign in again to launch the workspace."
          : "The isolated workspace could not be launched.");
      }
    };
    void launch();
    return () => { active = false; };
  }, [audience, enabled, nonce]);

  return { status, url, error, retry };
}
