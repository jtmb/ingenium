import type { ReactNode } from "react";

export interface WorkControlBinding {
  ownerId: string;
  organizationId: string | null;
  runtimeId: string | null;
  workspaceId: string | null;
  sessionId: string | null;
}

/** Presentation matching only. Domain controllers and APIs retain admission authority. */
export function workControlBindingMatches(expected: WorkControlBinding, current: WorkControlBinding): boolean {
  return expected.ownerId === current.ownerId && expected.organizationId === current.organizationId
    && expected.runtimeId === current.runtimeId && expected.workspaceId === current.workspaceId
    && expected.sessionId === current.sessionId;
}

export interface WorkContextSlots {
  binding: WorkControlBinding;
  projectControl?: ReactNode;
  environmentControl?: ReactNode;
  permissionControl?: ReactNode;
  memoryControl?: ReactNode;
  voiceControl?: ReactNode;
  dot?: ReactNode;
  tools?: ReactNode;
  status?: ReactNode;
  panels?: ReactNode;
}
