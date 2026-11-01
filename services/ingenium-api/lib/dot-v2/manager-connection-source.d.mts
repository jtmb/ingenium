import type {ClientRequest} from 'node:http';
import type {ManagerProcessSourceFacts} from './manager-process-source.mjs';
declare const originalManagerConnection:unique symbol;
export interface OriginalManagerConnection {readonly [originalManagerConnection]:true;}
export function openOriginalManagerConnection():Promise<OriginalManagerConnection>;
export function readOriginalManagerConnection(original:OriginalManagerConnection):Readonly<ManagerProcessSourceFacts & {connectionId:string}>;
export function closeOriginalManagerConnection(original:OriginalManagerConnection):void;

export interface OriginalManagerCandidateHandshake {readonly runId:string;readonly attemptId:string;readonly challenge:string;readonly intentHash:string;readonly specHash:string;readonly selectionSha256:string;readonly deadlineAt:string;}
/** Transport only; never a Core/image execution grant. */
export function createOriginalManagerCandidateRequest(original:OriginalManagerConnection,runId:string,input:OriginalManagerCandidateHandshake):ClientRequest;
export function readOriginalManagerCandidateRequest(original:OriginalManagerConnection,request:ClientRequest):Readonly<ManagerProcessSourceFacts & {connectionId:string;runId:string;requestBodySha256:string;deadlineAt:string}>;

export function refreshOriginalManagerCandidateRequest(original:OriginalManagerConnection,request:ClientRequest,encoded:string):ReturnType<typeof readOriginalManagerCandidateRequest>;
