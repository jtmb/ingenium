import type {Request}from'express';
import type {getDb,workspaceRuntimeCredentialsV2}from'ingenium-core';
import type {WorkspaceExecutionFacts}from'./projectless-context.mjs';
export function authenticateWorkspaceMcpCredentialV2(request:Request):workspaceRuntimeCredentialsV2.WorkspaceRuntimeCredentialV2;
export function withOriginalWorkspaceMcpPlacement<T>(request:Request,work:()=>T|Promise<T>):Promise<T>;
export function resolveOriginalWorkspaceMcpFacts(request:Request):Readonly<{db:ReturnType<typeof getDb>;credential:workspaceRuntimeCredentialsV2.WorkspaceRuntimeCredentialV2;original:{runtimeId:string;parentContainerId:string;startIdentity:string;hostId:string;imageId:string};execution:Readonly<WorkspaceExecutionFacts>}>;
