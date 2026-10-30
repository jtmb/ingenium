import type {Core126Handlers,OriginalCandidateLease} from './managed-job-contracts.mjs';
import type {CandidateLifecycleBinding} from './candidate-lifecycle-original-gates.mjs';
import type {CandidateLifecyclePhase} from './candidate-lifecycle-owner.mjs';
export interface CandidateManagerState {readonly intent:Readonly<Record<string,unknown>>;readonly binding:CandidateLifecycleBinding;readonly phase:CandidateLifecyclePhase;readonly revision:number;readonly cancelRequested:boolean;readonly unknown:boolean;readonly childCreatedMs:number|null;}
export interface CandidateManagerStateOwner {candidateOriginalManagerState(runId:string,managerContext:unknown,originalContext:unknown):CandidateManagerState;}
export function captureOriginalCandidateManagerBody(request:object,bytes:Buffer):void;
export function readOriginalCandidateManagerBody(request:object):Buffer|undefined;
export function createOriginalCandidateManagerHttp(owner:CandidateManagerStateOwner):(request:Parameters<Core126Handlers['internal']>[0]&{originalCandidateBody?:Buffer})=>ReturnType<Core126Handlers['internal']>;
