import type { LocalEnvironment, LocalWorkspaceOwner, LocalOperationRequest, LocalOperationReceipt } from "@veyra/contracts";
import type { Gateway } from "../../../platform/types";
export type LocalIdentity = Pick<LocalWorkspaceOwner, "installation_id" | "custodian_key" | "service_instance_id" | "environment">;
export type WorkspaceObservation = Readonly<{ owner: LocalWorkspaceOwner; workspace: {
  id: string; environment: LocalEnvironment; revision: number; state: string; root_path: string; root_identity: string;
} }>;
export type SessionObservation = Readonly<{ id: string; location: { directory: string } }>;
export type ChatOperation = Extract<LocalOperationRequest["operation"], { kind: "session_create" | "agent_turn" | "session_interrupt" | "session_select_model" | "session_select_agent" }>;
export type Seal = { wire: string; sha256: string; phase: "reserved" | "unknown" | "committed" | "rejected"; receipt: LocalOperationReceipt | null; observation?: SessionObservation };
export interface LocalTransport {
  readContext(current: () => boolean): Promise<unknown>;
  readRuntime(workspaceID: string, current: () => boolean): Promise<unknown>;
  readSessions(workspaceID: string, after: string | null, current: () => boolean): Promise<unknown>;
  readMessages(workspaceID: string, sessionID: string, cursor: string | null, current: () => boolean): Promise<unknown>;
  readStatus(workspaceID: string, sessionID: string, current: () => boolean): Promise<unknown>;
  createWorkspace(body: { request_id: string; environment: LocalEnvironment }, current: () => boolean): Promise<unknown>;
  readWorkspace(id: string, current: () => boolean): Promise<unknown>;
  dispatch(body: LocalOperationRequest, current: () => boolean): Promise<unknown>;
  readReceipt(id: string, current: () => boolean): Promise<unknown>;
  readSession(workspaceID: string, sessionID: string, current: () => boolean): Promise<unknown>;
}
export const UUID: RegExp;
export function identity(value: unknown): LocalIdentity;
export function owner(value: unknown): LocalWorkspaceOwner;
export function realm(value: LocalIdentity): string;
export function same(a: unknown, b: unknown): boolean;
export function createWire(id: string, environment: LocalEnvironment): string;
export function operationWire(id: string, owner: LocalWorkspaceOwner, operation: ChatOperation): string;
export function sha256(value: string): Promise<string>;
export function environment(value: unknown): LocalEnvironment;
export function requireValue(ok: unknown, message: string): asserts ok;
export function clone<T>(value: T): T;
export function createLocalTransport(gateway: Pick<Gateway, "workbench">): LocalTransport;
