import type {Server,IncomingMessage,ServerResponse} from 'node:http';
import type {ManagerProcessSourceFacts} from './manager-process-source.mjs';
declare const originalManagerDelegation:unique symbol;
export interface OriginalManagerDelegation {readonly [originalManagerDelegation]:true;}
export const MANAGER_ORIGINAL_CONNECTION_PATH:'/v1/manager-original/connection';
export function createOriginalManagerPeerOwner(server:Server,token:string):Readonly<{
 challenge(request:IncomingMessage,response:ServerResponse,input:unknown):Promise<Readonly<{schemaVersion:1;kind:'original-manager-connection';challenge:string;connectionId:string;source:Readonly<ManagerProcessSourceFacts>;mac:string}>>;
 begin(request:IncomingMessage,response:ServerResponse):OriginalManagerDelegation;
 assertPending(original:OriginalManagerDelegation):void;
 continuation(original:OriginalManagerDelegation):Promise<OriginalManagerContinuation>;
 refresh(original:OriginalManagerDelegation):Promise<Readonly<ManagerProcessSourceFacts & {connectionId:string}>>;
 inspect(original:OriginalManagerDelegation):Readonly<ManagerProcessSourceFacts & {connectionId:string}>;
}>;
export interface OriginalManagerContinuation {readonly schemaVersion:1;readonly kind:'original-manager-pending-source';readonly connectionId:string;readonly challenge:string;readonly source:Readonly<ManagerProcessSourceFacts>;readonly request:Readonly<{method:'POST';path:string;bodySha256:string}>;readonly mac:string;}
export function assertOriginalManagerDelegation(original:OriginalManagerDelegation,request:IncomingMessage,response:ServerResponse):void;
export function captureOriginalManagerContinuation(original:OriginalManagerDelegation):Promise<OriginalManagerContinuation>;
