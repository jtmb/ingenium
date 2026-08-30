"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createOpenCodeClient, type OpenCodeClient } from "./opencode";
import { useRuntimeWorkspace, type RuntimeWorkspaceController } from "./use-runtime-launch";
import { useAuth } from "./AuthContext";
import { useProject } from "./ProjectContext";

interface RuntimeState {
  workspace: RuntimeWorkspaceController;
  client: OpenCodeClient | null;
  runtimeId: string | null;
  projectName: string | null;
}

const RuntimeContext = createContext<RuntimeState | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const projectName = useProject();
  return <ScopedRuntimeProvider key={`${user.id}:${projectName}`} userId={user.id} projectName={projectName}>{children}</ScopedRuntimeProvider>;
}

function ScopedRuntimeProvider({ children, userId, projectName }: { children: ReactNode; userId: string; projectName: string }) {
  const workspace = useRuntimeWorkspace({ userId, projectName });
  const runtimeId = workspace.mode === "isolated" ? workspace.confirmedRuntimeId : null;
  const client = useMemo(() => {
    if (workspace.mode === "compatibility" && workspace.status === "ready") return createOpenCodeClient(null);
    return runtimeId && workspace.status === "ready" ? createOpenCodeClient(runtimeId) : null;
  }, [runtimeId, workspace.mode, workspace.status]);

  return <RuntimeContext.Provider value={{ workspace, client, runtimeId, projectName: workspace.confirmedProjectName }}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): RuntimeState {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error("useRuntime must be used inside RuntimeProvider");
  return value;
}

export function useOpenCodeClient(): OpenCodeClient {
  const client = useRuntime().client;
  if (!client) throw new Error("An authorized OpenCode runtime must be selected and running");
  return client;
}
