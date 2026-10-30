import type { Request } from "express";
import type { RequestPrincipal, AttestedCoordinationIdentity } from "../middleware/auth.js";
import type { runtimes, contextConversations } from "ingenium-core";
export interface RequestExecutionSelection { projectId: string|null; workspaceId: string; runtimeId: string }
export interface RequestExecutionFacts extends RequestExecutionSelection {
  organizationId: string; ownerUserId: string; bindingHash: string; bindingEpoch: number;
  status: "authorized"; mode: "runtime"|"native"|"compatibility"; hostId: string; environmentId: string; available: true;
}
export interface RequestChatBinding extends RequestExecutionFacts {
  chatId: string; visibility: "private"; engineSessionId: string;
}
export interface PlacementRequest {
  organizationId: string; ownerUserId: string; projectId: string; workspaceId: string;
  bindingHash: string; bindingEpoch: number; runtimeId: string; runtimeRevision: number;
  backendName: string; backendContainerId: string; now: number;
}
export interface TrustedPlacement extends Omit<PlacementRequest,"now"> {
  hostId: string; environmentId: string; observedAt: number; expiresAt: number;
}
export type RequestIdentity = { principal: RequestPrincipal; attestation?: Readonly<AttestedCoordinationIdentity> };
export type PlacementResolver = (facts: Readonly<PlacementRequest>) => Readonly<TrustedPlacement>|null;
export interface RequestExecutionPorts {
  revalidateIdentity(request: Request): RequestIdentity|null;
  deploymentMode(): string;
  getWorkspace(id: string): runtimes.AuthorizedWorkspace|undefined;
  getRuntime(id: string): runtimes.RuntimeInstance|undefined;
  resolveOwnership(identity: RequestIdentity, selected: RequestExecutionSelection): {
    organizationId: string; ownerUserId: string; projectId: string; workspaceId: string;
  }|null;
  authorizeProject(identity: RequestIdentity, workspace: runtimes.AuthorizedWorkspace): boolean;
  resolvePlacement: PlacementResolver;
  getConversation(projectId: string, chatId: string): contextConversations.ContextConversationSummary|undefined;
  authorizeConversation(identity: RequestIdentity, chat: contextConversations.ContextConversationSummary): boolean;
  conversationIsActive(projectId: string, chatId: string): boolean;
  now(): number;
}
export class RequestExecutionError extends Error { readonly code: string; readonly status: number; constructor(code: string,status?: number) }
export function createRequestExecutionResolvers(ports: RequestExecutionPorts): Readonly<{
  resolveRequestExecution(request: Request, selected: RequestExecutionSelection): Readonly<RequestExecutionFacts>;
  resolveRequestChatBinding(request: Request, execution: RequestExecutionFacts, chatId: string): Readonly<RequestChatBinding>;
}>;
