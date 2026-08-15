"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, request } from "./api";
import {
  OPENCODE_CLI_GATEWAY_URL,
  OPENCODE_WEB_GATEWAY_URL,
  VSCODE_GATEWAY_URL,
} from "./runtime-urls";

export type RuntimeAudience = "web" | "cli" | "vscode";
export type RuntimeLaunchStatus = "loading" | "starting" | "ready" | "expired" | "unavailable";
export type RuntimeWorkspaceStatus = "loading" | "empty" | "selecting" | "starting" | "ready" | "error" | "unavailable";

export interface RuntimeWorkspaceOption {
  id: string;
  organizationName: string;
  projectName: string;
  status: "ready" | "starting" | "stopped" | "unavailable";
}

type RuntimeDescriptor = {
  mode: "compatibility" | "isolated";
  status: "ready" | "no_runtime" | "starting" | "unavailable";
  reason: "no_authorized_workspace" | "explicit_start_required" | "runtime_starting" | "runtime_unavailable" | null;
};

type RuntimeLaunch = { launchUrl: string; status: "ready" };
type RuntimeStart = { status: "ready" | "starting" };

export const RUNTIME_START_POLL_MS = 1_000;
export const RUNTIME_START_MAX_ATTEMPTS = 10;
const LAST_WORKSPACE_KEY = "ingenium-runtime-workspace-preference";

function compatibilityUrl(audience: RuntimeAudience): string {
  if (audience === "web") return OPENCODE_WEB_GATEWAY_URL;
  if (audience === "cli") return OPENCODE_CLI_GATEWAY_URL;
  return VSCODE_GATEWAY_URL;
}

function createExchangeProof(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function preferredWorkspace(options: RuntimeWorkspaceOption[]): string | null {
  try {
    const preferred = localStorage.getItem(LAST_WORKSPACE_KEY);
    return preferred && options.some((workspace) => workspace.id === preferred) ? preferred : null;
  } catch {
    return null;
  }
}

export function useRuntimeWorkspace(enabled = true) {
  const [mode, setMode] = useState<RuntimeDescriptor["mode"] | null>(null);
  const [status, setStatus] = useState<RuntimeWorkspaceStatus>("loading");
  const [workspaces, setWorkspaces] = useState<RuntimeWorkspaceOption[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [confirmedWorkspaceId, setConfirmedWorkspaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => {
    setStatus("loading");
    setMode(null);
    setWorkspaces([]);
    setSelectedWorkspaceId(null);
    setConfirmedWorkspaceId(null);
    setError(null);
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = async () => {
      try {
        const descriptor = await request<{ data: RuntimeDescriptor }>("/runtimes/browser/status");
        if (!active) return;
        setMode(descriptor.data.mode);
        if (descriptor.data.mode === "compatibility") {
          setStatus("ready");
          return;
        }
        if (descriptor.data.status === "unavailable") {
          setStatus("unavailable");
          setError("Isolated workspace runtimes are unavailable.");
          return;
        }
        const listed = await request<{ data: RuntimeWorkspaceOption[] }>("/runtimes/browser/workspaces");
        if (!active) return;
        setWorkspaces(listed.data);
        if (listed.data.length === 0) {
          setStatus("empty");
          setError("No workspace has been authorized for your account.");
          return;
        }
        setSelectedWorkspaceId(preferredWorkspace(listed.data));
        setStatus("selecting");
      } catch (failure) {
        if (!active) return;
        setStatus("error");
        setError(failure instanceof ApiError && failure.status === 401
          ? "Your dashboard session expired. Sign in again to view workspaces."
          : "Authorized workspaces could not be loaded.");
      }
    };
    void load();
    return () => { active = false; };
  }, [enabled, nonce]);

  const selectWorkspace = useCallback((workspaceId: string) => {
    if (!workspaces.some((workspace) => workspace.id === workspaceId)) return;
    setSelectedWorkspaceId(workspaceId);
    setError(null);
  }, [workspaces]);

  const start = useCallback(async () => {
    if (mode !== "isolated" || !selectedWorkspaceId
      || !workspaces.some((workspace) => workspace.id === selectedWorkspaceId)) return;
    setStatus("starting");
    setError(null);
    try {
      const started = await request<{ data: RuntimeStart }>(
        `/runtimes/browser/workspaces/${encodeURIComponent(selectedWorkspaceId)}/start`,
        { method: "POST", body: "{}" },
      );
      let current = started.data.status;
      for (let attempt = 0; current === "starting" && attempt < RUNTIME_START_MAX_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, RUNTIME_START_POLL_MS));
        const listed = await request<{ data: RuntimeWorkspaceOption[] }>("/runtimes/browser/workspaces");
        const selected = listed.data.find((workspace) => workspace.id === selectedWorkspaceId);
        setWorkspaces(listed.data);
        if (!selected) throw new ApiError(404, "Workspace unavailable", null);
        current = selected.status === "ready" ? "ready" : "starting";
        if (selected.status === "unavailable") throw new Error("Workspace runtime unavailable");
      }
      if (current !== "ready") {
        setStatus("error");
        setError("The workspace is still starting. Retry to check again.");
        return;
      }
      try { localStorage.setItem(LAST_WORKSPACE_KEY, selectedWorkspaceId); } catch { /* Preference storage is optional. */ }
      setConfirmedWorkspaceId(selectedWorkspaceId);
      setStatus("ready");
    } catch (failure) {
      setStatus("error");
      setError(failure instanceof ApiError && failure.status === 429
        ? "Your active runtime quota has been reached."
        : failure instanceof ApiError && failure.status === 404
          ? "That workspace is no longer authorized for your account."
          : "The workspace could not be started.");
    }
  }, [mode, selectedWorkspaceId, workspaces]);

  return { mode, status, workspaces, selectedWorkspaceId, confirmedWorkspaceId, error, selectWorkspace, start, retry };
}

export type RuntimeWorkspaceController = ReturnType<typeof useRuntimeWorkspace>;

export function useRuntimeLaunch(audience: RuntimeAudience, workspace: RuntimeWorkspaceController, enabled = true) {
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
    if (!enabled || workspace.status !== "ready" || workspace.mode === null) return;
    let active = true;
    const launch = async () => {
      if (workspace.mode === "compatibility") {
        setUrl(compatibilityUrl(audience));
        setStatus("ready");
        return;
      }
      if (!workspace.confirmedWorkspaceId) return;
      try {
        const exchangeProof = createExchangeProof();
        const launched = await request<{ data: RuntimeLaunch }>("/runtimes/browser/launch", {
          method: "POST",
          body: JSON.stringify({ audience, exchangeProof, workspaceId: workspace.confirmedWorkspaceId }),
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
  }, [audience, enabled, nonce, workspace.confirmedWorkspaceId, workspace.mode, workspace.status]);

  return { status, url, error, retry };
}
