"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createOpenCodeClient, type OpenCodeClient } from "./opencode";
import { useRuntimeWorkspace, type RuntimeWorkspaceController } from "./use-runtime-launch";
import { useAuth } from "./AuthContext";
import { useProject } from "./ProjectContext";
import {useOrganization} from './OrganizationContext';
import {useSearchParams} from 'next/navigation';
import {useWorkspaceExecution} from '@/app/components/projects-v2/useWorkspaceExecution';
import type {ConfirmedWorkspaceExecution} from '@/app/components/projects-v2/workspace-execution-client.mjs';

interface RuntimeState {
  workspace: RuntimeWorkspaceController;
  client: OpenCodeClient | null;
  runtimeId: string | null;
  projectName: string | null;
  execution?: ConfirmedWorkspaceExecution | null;
  projectless?: boolean;
}

const RuntimeContext = createContext<RuntimeState | null>(null);

export function RuntimeProvider({ children, projectless = false }: { children: ReactNode; projectless?: boolean }) {
  return projectless ? <WorkspaceRuntimeProvider>{children}</WorkspaceRuntimeProvider> : <LegacyRuntimeProvider>{children}</LegacyRuntimeProvider>;
}

function WorkspaceRuntimeProvider({children}:{children:ReactNode}) {
 const {user}=useAuth(),organization=useOrganization(),params=useSearchParams();
 const values=params.getAll('runtime'),requestedRuntime=values.length===1&&values[0] ? values[0] : null;
 const {workspace,confirmed}=useWorkspaceExecution(user.id,organization.active?.id??null,requestedRuntime,organization.loading);
 const runtimeId=confirmed?.runtimeId??null;
 const client=useMemo(()=>confirmed?createOpenCodeClient(confirmed.runtimeId):null,[confirmed]);
 return <RuntimeContext.Provider value={{workspace,client,runtimeId,projectName:null,execution:confirmed,projectless:true}}>{children}</RuntimeContext.Provider>;
}

function LegacyRuntimeProvider({ children }: { children: ReactNode }) {
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
