import type {Readable,Writable} from "node:stream";
export interface CandidateSelection {readonly runId:string;readonly attemptId:string;readonly intentHash:string;readonly catalogSha256:string;readonly expiresAt:number;}
export interface CandidateBinding extends CandidateSelection {readonly childId:string;readonly childBirthHash:string;}
export interface CandidateLocalObservation {catalogSha256:string;trapAddress:"127.0.0.1:39261";proxyAddress:"127.0.0.1:39262";pid:number;}
export interface CandidateMaterial {capability:string;agentMaterial:unknown;}
export interface CandidateOriginalResponse {status:number;body:Buffer;}
export interface CandidateUnknown {code:"ORIGINAL_CANDIDATE_CHANNEL_UNKNOWN";runId:string;attemptId:string;}
export interface CandidateChildCarrier {readonly binding:Readonly<CandidateBinding>;readonly initialized:Promise<void>;readonly finished:Promise<void>;closed():boolean;observe(value:CandidateLocalObservation):Promise<void>;material():Promise<Readonly<CandidateMaterial>>;request(method:string,path:string,body:Buffer):Promise<CandidateOriginalResponse>;stop():void;}
export function candidateBinding(value:unknown,now?:number):Readonly<CandidateBinding>;
export function candidateSelection(value:unknown,now?:number):Readonly<CandidateSelection>;
export function candidateDenied():never;
export function exact(value:unknown,keys:string[]):unknown;
export function operationRoute(method:string,path:string,runId:string):string;
export function decodedBody(value:unknown,limit?:number):Buffer;
export function candidateFrames(input:Readable):AsyncGenerator<unknown>;
export function candidateWriter(output:Writable,options?:{deadline?:number;now?():number}):(value:unknown)=>Promise<void>;
export function createCandidateChildCarrier(options:{input:Readable;output:Writable;binding:unknown;now?():number;onUnknown?(value:CandidateUnknown):void}):CandidateChildCarrier;
export function createCandidateManagerCarrier(options:{input:Readable;output:Writable;binding:unknown;now?():number;onUnknown(value:CandidateUnknown):void;onObservation(value:Readonly<CandidateLocalObservation & {type:"observation";binding:CandidateBinding}>):void|Promise<void>;forwardOriginalRpc(value:{binding:CandidateBinding;method:string;operation:string;body:Buffer}):Promise<CandidateOriginalResponse>}):Readonly<{started:Promise<void>;finished:Promise<void>;closed():boolean;writeOriginalReleasedMaterial(frame:CandidateMaterial):Promise<void>;stop():void}>;
export declare const CANDIDATE_FRAME_LIMIT:number,CANDIDATE_BODY_LIMIT:number,CANDIDATE_TOTAL_LIMIT:number,CANDIDATE_FRAME_COUNT:number;
