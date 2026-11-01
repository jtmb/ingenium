import type {ClientRequest} from 'node:http';
import type {OriginalManagerCandidateHandshake} from './manager-connection-source.mjs';
declare const originalManagerIdentity:unique symbol;
export interface OriginalCandidateManagerRpcIdentity {readonly[originalManagerIdentity]:never;}
export function requireOriginalCandidateManagerRpcIdentity():Promise<OriginalCandidateManagerRpcIdentity>;
export function assertOriginalCandidateManagerRpcIdentity(identity:OriginalCandidateManagerRpcIdentity,channel:Readonly<{origin:string;socket:unknown;request:unknown;response:unknown;pending:Promise<unknown>}>):void;
export function requireOriginalCandidateRpcFacts(observation:unknown,operation:string,snapshot:unknown):void;
export function requireOriginalCandidateRpcWithdrawalControl(control:unknown,originalBinding:unknown):void;

export function createOriginalCandidateManagerRpcRequest(identity:OriginalCandidateManagerRpcIdentity,runId:string,input:OriginalManagerCandidateHandshake):ClientRequest;
export function refreshOriginalCandidateManagerRpcIdentity(identity:OriginalCandidateManagerRpcIdentity,encoded:string):unknown;
export function closeOriginalCandidateManagerRpcIdentity(identity:OriginalCandidateManagerRpcIdentity):void;
