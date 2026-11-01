export interface WorkspaceRuntimeCredentialV2 {schemaVersion:2;scopeKind:'workspace';projectId:null;projectIds:readonly [];credentialId:string;servicePrincipalId:string;organizationId:string;ownerUserId:string;workspaceId:string;runtimeId:string;bindingHash:string;bindingEpoch:number;expiresAt:string;runtimeState:string;scopes:readonly string[]}
export function issueWorkspaceRuntimeCredentialV2(runtimeId:string,expiresAt:Date,options?:{profile?:'scope-only'|'agent-memory-read'}):{id:string;token:string;servicePrincipalId:string;expiresAt:string;projectId:null;workspaceId:string;organizationId:string;ownerUserId:string;bindingHash:string;bindingEpoch:number};
export function inspectWorkspaceBootstrapCredentialV2(token:string):WorkspaceRuntimeCredentialV2|undefined;
export function inspectActiveWorkspaceRuntimeCredentialV2(token:string):WorkspaceRuntimeCredentialV2|undefined;
export function inspectWorkspaceMcpCredentialV2(token:string):WorkspaceRuntimeCredentialV2|undefined;
export function revokeWorkspaceRuntimeCredentialV2(runtimeId:string,issuedCredentialId?:string):void;
/** Private actual Core/API/gateway scope owners only; never serialize to browsers. */
export function workspaceRuntimeOpenCodeAuthV2(runtimeId:string):string;
