import type {OwnerScope,ExecutionBinding} from "../../../../packages/veyra-projects/contracts.js";
import type {NativeProjectCatalogAdapter} from "./native-catalog.mjs";
import type {ExecutionRequest} from "./execution.mjs";
export type ReviewedDomain="branch"|"change"|"worktree"|"archive"|"finding"|"triage"|"assessment";
export interface NativeContext {scope:OwnerScope;projectId:string|null;binding:ExecutionBinding;}
export interface NativeGatewayRequest {
  scope:OwnerScope;expectedInstanceId:string;method:"GET"|"POST";path:string;
  query:Record<string,string|number|boolean>;body?:unknown;maxResponseBytes:number;redirect:"error";
}
export interface NativeResult {state:"pending"|"succeeded"|"failed"|"unknown";result:{nativeReceipt:unknown;code?:string};}
export function terminalRequestFingerprint(body:unknown,terminalId?:string|null):string;
export class NativeWorkspaceTransport {
  constructor(dependencies:{
    transport:(request:Readonly<NativeGatewayRequest>)=>Promise<{instanceId:string;status:number;data:unknown}>;
    authorize:(scope:OwnerScope,capability:string,target:{instanceId:string;projectId:string|null;
      binding:ExecutionBinding|null;body?:unknown})=>boolean|Promise<boolean>;
  });
  projectOwner():ConstructorParameters<typeof NativeProjectCatalogAdapter>[0]["owner"];
  terminalDispatch(input:NativeContext & Omit<ExecutionRequest,"projectId"|"binding">):Promise<NativeResult>;
  terminalReceipt(input:NativeContext & Omit<ExecutionRequest,"projectId"|"binding">):Promise<NativeResult>;
  terminalRead(input:NativeContext & {terminalId?:string|null;after?:number}):Promise<unknown>;
  reviewRead(input:NativeContext & {base?:string;path?:string}):Promise<unknown>;
  previewReviewed(input:NativeContext & {domain:"worktree"|"archive";selection:Record<string,unknown>}):Promise<unknown>;
  submitReviewed(input:NativeContext & {domain:ReviewedDomain;original:Record<string,unknown>}):Promise<NativeResult>;
  reviewedReceipt(input:NativeContext & {domain:ReviewedDomain;original:Record<string,unknown>}):Promise<NativeResult>;
}
