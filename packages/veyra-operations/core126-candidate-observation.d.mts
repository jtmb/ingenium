import type {Core126ManagerProof} from './core126-image-owner.mjs';
export const CANDIDATE_SELECTION_FILE:'/run/ingenium-core126/candidate-source.json';
export const CANDIDATE_CATALOG:'/usr/local/share/ingenium/opencode-managed/candidate-inert-catalog.json';
export function assertCandidateSourceDefinition(value:unknown,now?:number):any;
export function readInstalledCandidateSource(now?:number):Readonly<{definition:any;selectionSha256:string}>;
export function originalCandidateReadonlyProbeSource():string;
export function assertCandidateMeasuredClosure(measurement:unknown,definition:any):true;
export function createOriginalCandidateClosureProducer(ports:{docker:(method:string,path:string)=>Promise<any>;makeOriginalRequest:(options:any,callback:any)=>any;now?:()=>number}):Readonly<{pendingObservations():readonly Record<string,unknown>[];reconcileUnknown(runtimeId:string):Promise<Readonly<Record<string,unknown>>>;observe(runtimeId:string):Promise<{schemaVersion:1;kind:'original-manager-unapproved-candidate-closure-v1';selectionSha256:string;proof:Core126ManagerProof;measurement:any;exec:any;completedAt:number}>}>;

export const CANDIDATE_SOURCE_MAX_BYTES:number;
