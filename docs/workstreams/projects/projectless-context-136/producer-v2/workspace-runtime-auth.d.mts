export interface WorkspaceRuntimeAuthBindingV2 {projectId:null;organizationId:string;ownerUserId:string;workspaceId:string;runtimeId:string;credentialId:string;bindingHash:string;bindingEpoch:number;executionGeneration:string;requestId:string}
/** Pure derivation only. Actual original credential/scope ownership is required by production callers. */
export function deriveWorkspaceRuntimeOpenCodePasswordV2(token:string,scope:WorkspaceRuntimeAuthBindingV2):string;
