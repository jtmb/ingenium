import type {IncomingMessage,ServerResponse} from "node:http";
import type {CandidateChildCarrier,CandidateLocalObservation} from "./candidate-carrier.mjs";
export declare const CANDIDATE_CATALOG:"/usr/local/share/ingenium/opencode-managed/candidate-inert-catalog.json",CANDIDATE_CORE_ORIGIN:"http://127.0.0.1:39262/api/v1";
export function readCandidateCatalog(expectedHash:string):Readonly<{sha256:string;bytes:number}>;
export function candidateRequestBody(request:IncomingMessage,limit?:number):Promise<Buffer>;
export function candidateTrapHandler(options?:{now?():number;stage?():string;getProgram?():import("./candidate-response-program.mjs").CandidateResponseProgram|undefined}):Readonly<{handler(request:IncomingMessage,response:ServerResponse):Promise<void>;observations():unknown[]}>;
export function candidateProxyHandler(carrier:CandidateChildCarrier,options?:{getProgram?():import("./candidate-response-program.mjs").CandidateResponseProgram|undefined}):Readonly<{handler(request:IncomingMessage,response:ServerResponse):Promise<void>;activate(value:string):void;clear():void}>;
export function openCandidateLoopback(carrier:CandidateChildCarrier):Promise<Readonly<{observation:Readonly<CandidateLocalObservation>;activate(capability:string):void;configureOriginalProgram(value:unknown,original:{agentHash:string;projectId:string}):void;programSnapshot():unknown;observations():unknown[];close():Promise<void>}>>;
