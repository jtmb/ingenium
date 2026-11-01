import {requireOriginalCandidateCoordinatorContext} from './dot-original-context.js';
import {spendOriginalCandidateRpcPhase,spendOriginalCandidateRpcUnknown} from '../runtime-manager-client.js';
import {requireOriginalCandidateControlContext} from './candidate-control-context.mjs';
/** Original negative-only control is backed by the private Core ledger owner.
 * Phase gates consume only the retained original RPC inside its SAME Core final transaction, with no injectable authorization callbacks.
 * Root must implement fixed exports using its genuine original Core/API/manager
 * private brands and retained original Docker create/attach/start/wait owners.
 * No object/JSON/status/Promise/boolean can reconstruct a phase, credential,
 * frame or physical proof. Material/result/retirement remain CLOSED.
 */
const closed=kind=>{throw Object.assign(Error("CORE131_ORIGINAL_"+kind+"_UNAVAILABLE"),{code:"CORE131_ORIGINAL_"+kind+"_UNAVAILABLE",status:503});};
export function requireOriginalCandidateLifecycleCurrent(context,binding){try{return requireOriginalCandidateCoordinatorContext(context,{runId:binding.runId,projectId:binding.projectId,runtimeId:binding.runtimeId,workspaceId:binding.workspaceId})}catch{return closed("CURRENT_CONTEXT")}}
export function requireOriginalCandidateLifecycleControl(context,binding){try{return requireOriginalCandidateControlContext(context,binding)}catch{try{return requireOriginalCandidateCoordinatorContext(context,{runId:binding.runId,projectId:binding.projectId,runtimeId:binding.runtimeId,workspaceId:binding.workspaceId})}catch{return closed("CONTROL_CONTEXT")}}}
export function requireOriginalCandidateCreateIntent(handle,binding,context){return spendOriginalCandidateRpcPhase(handle,'create-intent',binding,context)}
export function requireOriginalCandidateChild(handle,binding,context){return spendOriginalCandidateRpcPhase(handle,'created',binding,context)}
export function requireOriginalCandidateAttachIntent(handle,binding,context){return spendOriginalCandidateRpcPhase(handle,'start-intent',binding,context)}
export function requireOriginalCandidateWaiting(handle,binding,context){return spendOriginalCandidateRpcPhase(handle,'waiting',binding,context)}
export function requireOriginalCandidateReady(handle,binding,context){return spendOriginalCandidateRpcPhase(handle,'ready',binding,context)}
export function spendOriginalCandidateMaterial(){return closed("MATERIAL_CONSTRUCTOR");}
export function requireOriginalCandidateRunning(){return closed("RUNNING_OWNER");}
export function requireOriginalCandidateResult(){return closed("RESULT_OWNER");}
export function requireOriginalCandidateUnknown(handle,binding,context){return spendOriginalCandidateRpcUnknown(handle,binding,context);}
export function requireOriginalCandidateRetirement(){return closed("RETIREMENT_OWNER");}
