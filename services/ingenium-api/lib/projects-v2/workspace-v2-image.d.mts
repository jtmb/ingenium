export interface WorkspaceV2File {path:string;sha256:string;bytes:number;uid:number;gid:number;mode:number;kind:'file'}
export interface WorkspaceV2ImageDefinition {schemaVersion:2;backendKind?:'kubernetes';pullReference?:string;imageId:string;manifestSha256:string;sourceRevision:string;sourceSha256:string;validUntil:number;imageConfig:unknown;credentialScopes:readonly string[];files:readonly WorkspaceV2File[]}
export const WORKSPACE_V2_SOURCE_INPUTS:readonly string[];
export function validateWorkspaceV2ImageInputs(sourceFiles:unknown,files:unknown):{sourceFilesSha256:string;artifactSetSha256:string};
export function validateWorkspaceV2ImageManifest(manifest:unknown):unknown;
export const KUBERNETES_WORKSPACE_V1_SOURCE_INPUTS:readonly string[];
export const KUBERNETES_WORKSPACE_V2_SOURCE_INPUTS:readonly string[];
export function validateKubernetesWorkspaceV1ImageManifest(manifest:unknown):unknown;
export const WORKSPACE_V2_ARTIFACTS:readonly string[];
export const WORKSPACE_V2_CASES:Readonly<Record<string,unknown>>;
export function workspaceV2ImageDefinition(manifest:unknown,approval:unknown):WorkspaceV2ImageDefinition;
export function verifyWorkspaceArchive(bytes:Buffer,expected:WorkspaceV2File):{path:string;sha256:string;bytes:number};

export const WORKSPACE_V2_CREDENTIAL_SCOPES:readonly string[];
