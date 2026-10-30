/** Fixed missing original manager source/process/backend owner. No DTO issuer,
 * caller callback, URL-selected alternate or positive registration is exported. */
const unavailable=()=>{throw Object.assign(Error('ORIGINAL_MANAGER_SOURCE_PROCESS_BACKEND_UNAVAILABLE'),{code:'ORIGINAL_MANAGER_SOURCE_PROCESS_BACKEND_UNAVAILABLE',status:503});};
export function requireOriginalCandidateManagerRpcIdentity(){return unavailable();}
export function assertOriginalCandidateManagerRpcIdentity(){return unavailable();}
export function requireOriginalCandidateRpcFacts(){throw Object.assign(Error('ORIGINAL_CANDIDATE_RPC_FIXED_FACTS_ENTRYPOINT_UNAVAILABLE'),{code:'ORIGINAL_CANDIDATE_RPC_FIXED_FACTS_ENTRYPOINT_UNAVAILABLE',status:503});}
export function requireOriginalCandidateRpcWithdrawalControl(){throw Object.assign(Error('ORIGINAL_CANDIDATE_RPC_NEGATIVE_CONTROL_UNAVAILABLE'),{code:'ORIGINAL_CANDIDATE_RPC_NEGATIVE_CONTROL_UNAVAILABLE',status:503});}
