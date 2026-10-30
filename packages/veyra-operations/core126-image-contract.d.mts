import type {Core126ImageConfig,Core126ParentProof} from './core126-image-owner.mjs';
export const CORE126_PROTOCOL:'scoped-core126-mcp-v1';
export const SOURCE_INPUTS:readonly string[],IMAGE_INPUTS:readonly string[];
export const UUID:RegExp;
export const hex:(value:unknown)=>boolean,imageId:(value:unknown)=>boolean,text:(value:unknown)=>boolean,integer:(value:unknown)=>boolean;
export function canonical(value:unknown):unknown;
export function hash(value:unknown):string;
export function originalJsonHash(value:unknown):string;
export function freeze<T>(value:T):Readonly<T>;
export function unavailable(reason:string):never;
export function scopes(value:unknown):string[];
export const PROTOCOL_CASES:Readonly<Record<string,unknown>>;
export interface Core126Manifest {
 schemaVersion:1;format:'core126-immutable-image-qualification';target:'user-runtime';transport:'scoped-core126-mcp-v1';jobRunAudience:'job-run';imageId:string;configSha256:string;config:Core126ImageConfig;
 source:{revision:string;sha256:string;files:{path:string;bytes:number;sha256:string}[]};
 files:{path:string;bytes:number;sha256:string;uid:0;gid:0;kind:'file';mode:number}[];filesSha256:string;harnessSha256:string;approvedScopes:string[];
 protocolEvidence:{caseId:string;imageId:string;filesSha256:string;harnessSha256:string;traceSha256:string;exitCode:0;evidenceClass:'actual-image-inert-protocol-harness'}[];
}
export function validateManifest(value:unknown):Core126Manifest;
/** Sanitizes the original Docker inspect result, returning hashes instead of Env/profile contents. */
export function publicContainer(container:unknown):Core126ParentProof;