declare const originalManagerIdentity:unique symbol;
export interface OriginalCandidateManagerRpcIdentity {readonly[originalManagerIdentity]:never;}
export function requireOriginalCandidateManagerRpcIdentity():OriginalCandidateManagerRpcIdentity;
export function assertOriginalCandidateManagerRpcIdentity(identity:OriginalCandidateManagerRpcIdentity,channel:Readonly<{origin:string;socket:unknown;request:unknown;response:unknown;pending:Promise<unknown>}>):void;
export function requireOriginalCandidateRpcFacts(observation:unknown,operation:string,snapshot:unknown):void;
export function requireOriginalCandidateRpcWithdrawalControl(control:unknown,originalPreparation:unknown):void;
