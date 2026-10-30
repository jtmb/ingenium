/** CLOSED constructor gates. These are not injectable authorization callbacks.
 * Root must implement fixed exports using its genuine original Core/API/manager
 * private brands and retained original Docker create/attach/start/wait owners.
 * Until that actual composition exists, no object/JSON/status/Promise/boolean
 * can authorize a lifecycle transition, credential, frame or physical proof.
 */
const closed=kind=>{throw Object.assign(Error("CORE131_ORIGINAL_"+kind+"_UNAVAILABLE"),{code:"CORE131_ORIGINAL_"+kind+"_UNAVAILABLE",status:503});};
export function requireOriginalCandidateLifecycleCurrent(){return closed("CURRENT_CONTEXT");}
export function requireOriginalCandidateLifecycleControl(){return closed("CONTROL_CONTEXT");}
export function requireOriginalCandidateCreateIntent(){return closed("CREATE_OWNER");}
export function requireOriginalCandidateChild(){return closed("CHILD_OWNER");}
export function requireOriginalCandidateAttachIntent(){return closed("ATTACH_OWNER");}
export function requireOriginalCandidateWaiting(){return closed("WAITING_OWNER");}
export function requireOriginalCandidateReady(){return closed("READINESS_OWNER");}
export function spendOriginalCandidateMaterial(){return closed("MATERIAL_CONSTRUCTOR");}
export function requireOriginalCandidateRunning(){return closed("RUNNING_OWNER");}
export function requireOriginalCandidateResult(){return closed("RESULT_OWNER");}
export function requireOriginalCandidateUnknown(){return closed("UNKNOWN_OWNER");}
export function requireOriginalCandidateRetirement(){return closed("RETIREMENT_OWNER");}
