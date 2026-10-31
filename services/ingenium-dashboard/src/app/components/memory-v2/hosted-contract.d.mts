import type { LearnedMemoryRow } from './LearnedMemoryList';
import type { MemoryBinding, PendingMemoryChange, PolicyReceipt } from './controller.mjs';
export interface HostedSelection { actorUserId:string; organizationId:string; projectId:string; workspaceId:string; runtimeId:string; engineSessionId:string }
export interface HostedBinding extends HostedSelection { schemaVersion:1; available:true; contextConversationId:string; scopeHash:string; bindingHash:string; bindingEpoch:number; canChange:boolean; canForget:boolean }
export interface InspectionWindow { candidateOffset:number; limit:number; scanned:number; returned:number; unavailableMemoryCount:number; deferredForSourceBudget:number; hasMore:boolean; nextCandidateOffset:number|null }
export interface InspectionPage { items:LearnedMemoryRow[]; sourceWindow:InspectionWindow }
export interface ManagementRecord { operationId:string; scopeHash:string; origin:MemoryBinding; action:'forget'|'reset'; memoryId?:string; expectedVersion?:number; confirmation?:string }
export interface ManagementReceipt {status:'committed';scopeHash:string;operationId:string;operation:'forget'|'reset';forgottenCount:number;memoryId?:string;version?:number}
export const selectionFields:readonly string[];
export function text(v:unknown):v is string;
export function integer(v:unknown):v is number;
export function exact(v:unknown,keys:readonly string[]):boolean;
export function hostedSelection(v:unknown):HostedSelection;
export function sameSelection(a:unknown,b:unknown):boolean;
export function hostedBinding(v:unknown,s:HostedSelection):HostedBinding;
export function sameBinding(a:HostedBinding,b:HostedBinding):boolean;
export function controllerBinding(b:HostedBinding):MemoryBinding;
export function validateInspection(body:unknown,offset:number,limit:number):InspectionPage;
export function policyReceipt(v:unknown,r:PendingMemoryChange):PolicyReceipt;
export function managementReceipt(v:unknown,r:ManagementRecord):ManagementReceipt;
export function definitiveRejection(error:unknown):boolean;
