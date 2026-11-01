import type {Buffer} from 'node:buffer';
import type {Core126Manifest} from '../../packages/veyra-operations/core126-image-contract.mjs';
export interface Core126ManifestProducerPorts {
 frozenSource():Promise<{revision:string;sha256:string;files:readonly {path:string;bytes:number;sha256:string}[]}>;
 sourceFile(path:string):Promise<Buffer>;
 /** Raw OCI image config JSON bytes, whose digest equals the actual Docker image ID. */
 imageConfig(imageId:string):Promise<Buffer>;
 imageFile(imageId:string,path:string):Promise<{bytes:Buffer;uid:number;gid:number;kind:'file';mode:number}>;
 harnessIdentity():Promise<string>;
 inertWorkspaceProtocolCase?(input:{imageId:string;artifactSetSha256:string;sourceFilesSha256:string;harnessSha256:string;caseId:string}):Promise<{imageId:string;artifactSetSha256:string;sourceFilesSha256:string;harnessSha256:string;caseId:string;exitCode:number;trace:unknown;evidenceClass:'actual-image-inert-workspace-v2-harness'}>;
 /** Actual approved inert image harness, never a bool or expected-trace echo adapter. */
 inertProtocolCase(input:{imageId:string;filesSha256:string;harnessSha256:string;caseId:string}):Promise<{imageId:string;filesSha256:string;harnessSha256:string;caseId:string;exitCode:number;trace:unknown;evidenceClass:'actual-image-inert-protocol-harness'}>;
}
export function produceCore126ImageManifest(ports:Core126ManifestProducerPorts,input:{imageId:string;approvedScopes:readonly string[];workspaceRuntimeV2?:boolean}):Promise<{manifest:Core126Manifest;bytes:Buffer;sha256:string;approvalGranted:false;evidenceClass:string}>;