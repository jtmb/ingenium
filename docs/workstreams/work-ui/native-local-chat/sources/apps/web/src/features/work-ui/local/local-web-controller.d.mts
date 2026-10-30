import type { LocalWorkspaceOwner } from "@veyra/contracts";
export type WebBounds = { x: number; y: number; width: number; height: number; viewport_width: number; viewport_height: number };
export type LocalWebBinding = { kind: "qualified"; owner: LocalWorkspaceOwner; session_id: string; binding_id: string; invalidation_epoch: string };
export type WebState = { binding_id: string; invalidation_epoch: string; visibility: "hidden" | "visible" | "closed" };
export interface LocalWebPort {
  readBinding(request: { owner: LocalWorkspaceOwner; session_id: string }, current: () => boolean): Promise<LocalWebBinding | { kind: "unavailable"; reason: string }>;
  show(binding: LocalWebBinding, bounds: WebBounds, current: () => boolean): Promise<WebState>;
  bounds(binding: LocalWebBinding, bounds: WebBounds, current: () => boolean): Promise<WebState>;
  hide(binding: LocalWebBinding): Promise<WebState>;
  readState(binding: LocalWebBinding): Promise<WebState>;
  release(binding: LocalWebBinding): Promise<WebState>;
}
export class LocalWebController {
  constructor(options: { actualOwner: LocalWorkspaceOwner; sessionID: string; port: LocalWebPort; current: () => boolean;
    refreshWork: () => Promise<void>; cleanupFailure: (bindingID: string, error: unknown) => void });
  getSnapshot(): Readonly<{ view: "work" | "web"; busy: boolean; pending: "show" | "hide" | "release" | null; error: string | null }>;
  subscribe(listener: () => void): () => void;
  enter(bounds: WebBounds): Promise<void>; work(): Promise<void>; check(): Promise<void>; resize(bounds: WebBounds): Promise<void>; dispose(): Promise<void>;
}
export function webBounds(value: unknown): WebBounds;
export function createLocalWebPort(invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>): LocalWebPort;
