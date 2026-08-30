"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  runtimeId: string | null;
}

export interface RuntimeWorkspaceScope {
  userId: string;
  projectName: string;
}

type RuntimeDescriptor = {
  mode: "compatibility" | "isolated";
  status: "ready" | "no_runtime" | "starting" | "unavailable";
  reason: "no_authorized_workspace" | "explicit_start_required" | "runtime_starting" | "runtime_unavailable" | null;
};

type RuntimeLaunch = { launchUrl: string; status: "ready" };
type RuntimeStart = { status: "ready" | "starting"; runtimeId: string | null };
type RuntimeHealth = { status: "ready" | "unavailable" };

export const RUNTIME_START_POLL_MS = 1_000;
export const RUNTIME_START_MAX_ATTEMPTS = 60;
const LEGACY_WORKSPACE_KEY = "ingenium-runtime-workspace-preference";

type StoredRuntimeBinding = RuntimeWorkspaceScope & {
  workspaceId: string;
  runtimeId: string;
};

export function runtimeWorkspacePreferenceKey(scope: RuntimeWorkspaceScope): string {
  return `ingenium-runtime-workspace-preference:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.projectName)}`;
}

function compatibilityUrl(audience: RuntimeAudience): string {
  if (audience === "web") return OPENCODE_WEB_GATEWAY_URL;
  if (audience === "cli") return OPENCODE_CLI_GATEWAY_URL;
  return VSCODE_GATEWAY_URL;
}

function createExchangeProof(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function storedRuntimeBinding(preferenceKey: string, scope: RuntimeWorkspaceScope): StoredRuntimeBinding | null {
  try {
    localStorage.removeItem(LEGACY_WORKSPACE_KEY);
    const stored = localStorage.getItem(preferenceKey);
    if (!stored) return null;
    const binding = JSON.parse(stored) as Partial<StoredRuntimeBinding>;
    if (binding.userId === scope.userId
      && binding.projectName === scope.projectName
      && typeof binding.workspaceId === "string"
      && typeof binding.runtimeId === "string") return binding as StoredRuntimeBinding;
    localStorage.removeItem(preferenceKey);
  } catch {
    try { localStorage.removeItem(preferenceKey); } catch { /* Preference storage is optional. */ }
  }
  return null;
}

function clearStoredWorkspace(preferenceKey: string): void {
  try { localStorage.removeItem(preferenceKey); } catch { /* Preference storage is optional. */ }
}

export function useRuntimeWorkspace(scope: RuntimeWorkspaceScope, enabled = true) {
  const { userId, projectName } = scope;
  const preferenceKey = runtimeWorkspacePreferenceKey(scope);
  const [mode, setMode] = useState<RuntimeDescriptor["mode"] | null>(null);
  const [status, setStatus] = useState<RuntimeWorkspaceStatus>("loading");
  const [workspaces, setWorkspaces] = useState<RuntimeWorkspaceOption[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [confirmedWorkspaceId, setConfirmedWorkspaceId] = useState<string | null>(null);
  const [confirmedRuntimeId, setConfirmedRuntimeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const startInFlight = useRef(false);
  const scopeGeneration = useRef(0);

  useEffect(() => {
    scopeGeneration.current += 1;
    return () => { scopeGeneration.current += 1; };
  }, [preferenceKey]);

  const confirmServerBinding = useCallback((workspace: RuntimeWorkspaceOption, runtimeId: string) => {
    if (workspace.projectName !== projectName) return false;
    const binding: StoredRuntimeBinding = { userId, projectName, workspaceId: workspace.id, runtimeId };
    try { localStorage.setItem(preferenceKey, JSON.stringify(binding)); } catch { /* Preference storage is optional. */ }
    setSelectedWorkspaceId(workspace.id);
    setConfirmedWorkspaceId(workspace.id);
    setConfirmedRuntimeId(runtimeId);
    setStatus("ready");
    setError(null);
    return true;
  }, [preferenceKey, projectName, userId]);

  const retry = useCallback(() => {
    setStatus("loading");
    setMode(null);
    setWorkspaces([]);
    setSelectedWorkspaceId(null);
    setConfirmedWorkspaceId(null);
    setConfirmedRuntimeId(null);
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
          clearStoredWorkspace(preferenceKey);
          setStatus("empty");
          setError("No workspace has been authorized for your account.");
          return;
        }
        const preferredBinding = storedRuntimeBinding(preferenceKey, { userId, projectName });
        if (!preferredBinding) {
          setSelectedWorkspaceId(null);
          setStatus("selecting");
          return;
        }
        const preferred = listed.data.find((workspace) => workspace.id === preferredBinding.workspaceId);
        if (!preferred || preferred.projectName !== projectName) {
          clearStoredWorkspace(preferenceKey);
          setSelectedWorkspaceId(null);
          setError("The remembered workspace is no longer authorized for this account and project. Choose an available workspace.");
          setStatus("selecting");
          return;
        }
        if (preferred.status !== "ready" || !preferred.runtimeId || preferred.runtimeId !== preferredBinding.runtimeId) {
          clearStoredWorkspace(preferenceKey);
          setSelectedWorkspaceId(preferred.id);
          setError(preferred.status === "stopped"
            ? "The remembered workspace is stopped. Open it to start a new runtime."
            : "The remembered workspace runtime is not ready. Choose a workspace or retry.");
          setStatus("selecting");
          return;
        }
        confirmServerBinding(preferred, preferred.runtimeId);
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
  }, [confirmServerBinding, enabled, nonce, preferenceKey, projectName, userId]);

  const selectWorkspace = useCallback((workspaceId: string) => {
    if (!workspaces.some((workspace) => workspace.id === workspaceId)) return;
    clearStoredWorkspace(preferenceKey);
    setSelectedWorkspaceId(workspaceId);
    setConfirmedWorkspaceId(null);
    setConfirmedRuntimeId(null);
    setError(null);
  }, [preferenceKey, workspaces]);

  const start = useCallback(async () => {
    const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
    if (startInFlight.current || mode !== "isolated" || !selectedWorkspaceId || !selectedWorkspace) return;
    if (selectedWorkspace.projectName !== projectName) {
      clearStoredWorkspace(preferenceKey);
      setSelectedWorkspaceId(null);
      setError("That workspace does not belong to the selected project.");
      setStatus("selecting");
      return;
    }
    if (selectedWorkspace.status === "ready") {
      if (selectedWorkspace.runtimeId) {
        confirmServerBinding(selectedWorkspace, selectedWorkspace.runtimeId);
      } else {
        setError("The workspace runtime is not ready. Refresh the workspace list and retry.");
      }
      return;
    }
    if (selectedWorkspace.status === "unavailable") {
      setError("The workspace runtime is unavailable.");
      return;
    }
    startInFlight.current = true;
    const generation = scopeGeneration.current;
    setStatus("starting");
    setError(null);
    try {
      const started = await request<{ data: RuntimeStart }>(
        `/runtimes/browser/workspaces/${encodeURIComponent(selectedWorkspaceId)}/start`,
        { method: "POST", body: "{}" },
      );
      if (scopeGeneration.current !== generation) return;
      let current = started.data.status;
      let runtimeId = started.data.runtimeId;
      let confirmedWorkspace = selectedWorkspace;
      for (let attempt = 0; current === "starting" && attempt < RUNTIME_START_MAX_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, RUNTIME_START_POLL_MS));
        if (scopeGeneration.current !== generation) return;
        const listed = await request<{ data: RuntimeWorkspaceOption[] }>("/runtimes/browser/workspaces");
        if (scopeGeneration.current !== generation) return;
        const selected = listed.data.find((workspace) => workspace.id === selectedWorkspaceId);
        setWorkspaces(listed.data);
        if (!selected) throw new ApiError(404, "Workspace unavailable", null);
        confirmedWorkspace = selected;
        current = selected.status === "ready" ? "ready" : "starting";
        runtimeId = selected.runtimeId;
        if (selected.status === "unavailable") throw new Error("Workspace runtime unavailable");
      }
      if (current !== "ready" || !runtimeId) {
        setStatus("error");
        setError("The workspace is still starting. Retry to check again.");
        return;
      }
      if (!confirmServerBinding(confirmedWorkspace, runtimeId)) {
        clearStoredWorkspace(preferenceKey);
        setSelectedWorkspaceId(null);
        setStatus("selecting");
        setError("That workspace no longer belongs to the selected project.");
      }
    } catch (failure) {
      setStatus("error");
      setError(failure instanceof ApiError && failure.status === 429
        ? "Your active runtime quota has been reached."
        : failure instanceof ApiError && failure.status === 404
          ? "That workspace is no longer authorized for your account."
          : "The workspace could not be started.");
    } finally {
      startInFlight.current = false;
    }
  }, [confirmServerBinding, mode, preferenceKey, projectName, selectedWorkspaceId, workspaces]);

  const confirmedProjectName = confirmedWorkspaceId
    ? workspaces.find((workspace) => workspace.id === confirmedWorkspaceId)?.projectName ?? null
    : null;

  return { mode, status, workspaces, selectedWorkspaceId, confirmedWorkspaceId, confirmedRuntimeId, confirmedProjectName, error, selectWorkspace, start, retry };
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
        try {
          const health = await request<{ data: RuntimeHealth }>(`/runtimes/browser/health?audience=${audience}`);
          if (!active) return;
          if (health.data.status !== "ready") {
            setStatus("unavailable");
            setError("The local runtime audience is unavailable. Check the service status and retry.");
            return;
          }
        } catch {
          if (!active) return;
          setStatus("unavailable");
          setError("The local runtime audience is unavailable. Check the service status and retry.");
          return;
        }
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
        const origin = new URL(launched.data.launchUrl).origin;
        const health = await fetch(`${origin}/__ingenium/health`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (!active) return;
        if (!health.ok) {
          setStatus("unavailable");
          setError("The runtime audience did not become ready. Check the runtime service and retry.");
          return;
        }
        setUrl(`${origin}/`);
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
