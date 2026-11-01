import type {CandidateLifecycleBinding} from './candidate-lifecycle-original-gates.mjs';
declare const originalCandidateControlContext:unique symbol;
export interface OriginalCandidateControlContext {readonly [originalCandidateControlContext]:true;}
export function createOriginalCandidateControlContext(runId:string):OriginalCandidateControlContext;
export function requireOriginalCandidateControlContext(context:unknown,binding:CandidateLifecycleBinding):void;
