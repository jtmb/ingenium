import type {CandidateBinding} from "./candidate-carrier.mjs";
export interface CandidateProviderResponse {readonly kind:"inert-provider-response";readonly status:200;readonly contentType:"text/event-stream";readonly body:Buffer;}
export interface CandidateResponseProgram {respond(request:{method:string;path:string;body:Buffer;stage:string}):CandidateProviderResponse|null;observeCoreResult(request:{method:string;path:string;body:Buffer},result:{status:number;body:Buffer}):void;reject():void;close():void;snapshot():unknown;}
export function assertCandidateResponseProgram(value:unknown,original:{binding:CandidateBinding;projectId:string;agentHash:string},now?:number):unknown;
export function createCandidateResponseProgram(value:unknown,original:{binding:CandidateBinding;projectId:string;agentHash:string},options?:{now?():number}):CandidateResponseProgram;
export declare const CANDIDATE_NATIVE_TOOL:"ingenium_ingenium_project_detail",CANDIDATE_TOOL_AGENT_PROJECTION:Readonly<Record<string,unknown>>,CANDIDATE_TOOL_AGENT_HASH:string,CANDIDATE_BASE_AGENT_HASH:string;
export declare const PROGRAM_REQUEST_BYTES:number,PROGRAM_TOTAL_REQUEST_BYTES:number,PROGRAM_RESPONSE_BYTES:number,PROGRAM_MESSAGE_LIMIT:number,PROGRAM_TOOL_LIMIT:number,PROGRAM_CORE_TEXT_BYTES:number;
