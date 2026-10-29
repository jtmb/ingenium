import type {OwnerScope,ProjectRef,ExecutionBinding} from "./contracts.js";
export class ProjectError extends Error {code:string;status:number;constructor(code:string,status?:number);}
export function requireValue(condition:unknown,code?:string,status?:number):asserts condition;
export function text(value:unknown,maxLength?:number):value is string;
export function scopeKey(scope:OwnerScope):string;
export function sameScope(a:OwnerScope,b:OwnerScope):boolean;
export function validateBinding(binding:ExecutionBinding):ExecutionBinding;
export interface ExecutionAdmission {
  scope:OwnerScope;binding:ExecutionBinding;projectId:string|null;online:boolean;
  capabilities:string[];terminalId?:string;actionId?:string;
}
export function resolveExecution(input:{scope:OwnerScope;project:ProjectRef|null;binding:ExecutionBinding;
  admission:ExecutionAdmission;capability:string}):Readonly<ExecutionBinding>;
export function transitionWorktree(record:{id:string;state:string;operationId:string;revision:number;recoveryRef?:string},
  next:string,evidence:Record<string,unknown>):{id:string;state:string;operationId:string;revision:number;recoveryRef?:string};
export function terminalDimensions(columns:number,rows:number):{columns:number;rows:number};
export function terminalInput(value:string):string;
export function readTerminalWindow(chunks:{sequence:number;data:string}[],afterSequence:number,maxBytes?:number):{
  chunks:{sequence:number;data:string}[];nextSequence:number;truncated:boolean;gap:boolean;requiredBytes:number|null;
};
