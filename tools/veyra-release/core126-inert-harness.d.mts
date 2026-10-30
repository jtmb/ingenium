import type {OriginalBinaryIo,OriginalContainerBinding} from './core126-docker-binary.mjs';
export const INERT_CASE_IDS:readonly string[];
export interface CandidateFile {path:string;sha256:string;bytes:number;}
export interface OriginalCandidate {imageId:string;schemaSha256:string;agentHash:string;source:{sha256:string;revision:string;files:CandidateFile[]};files:CandidateFile[];}
export interface OriginalCanaryFixture {kind:'core126-original-public-canary-v1';caseId:string;nonce:string;binding:OriginalContainerBinding;nativeInput?:Record<string,unknown>;coreApi?:{origin:string;token:string;runId:string;attemptId:string};otherAudienceToken?:string;privateToolName?:string;publicProjectName?:string;}
export function nativeAgentProjection(inventory:unknown):Record<string,unknown>;
export function evaluateNativeCase(caseId:string,report:any,context:{agentHash:string;schemaSha256:string}):Record<string,unknown>;
/** Original lifecycle functions perform real fixture operations; they never return pass/trace attestations. */
export function createCore126InertHarness(input:{io:OriginalBinaryIo;probeSource:Buffer;probeSha256:string;openOriginalCase(args:{caseId:string;nonce:string;imageId:string;sourceSha256:string;probeSha256:string}):Promise<OriginalCanaryFixture>;withdrawOriginalCase(fixture:OriginalCanaryFixture,args:{caseId:string;nonce:string}):Promise<void>;mutateOriginalCase?:(fixture:OriginalCanaryFixture,args:{caseId:string;nonce:string})=>Promise<void>}):Readonly<{run(candidate:OriginalCandidate):Promise<{schemaVersion:1;kind:string;imageId:string;sourceSha256:string;probeSha256:string;schemaSha256:string;filesSha256:string;cases:any[];state:string;imageApproved:false;approvalProduced:false}>}>;
export function assertNativePluginInventory(plugins:unknown):void;
