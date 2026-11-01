import type { HostedSelection, HostedBinding, InspectionPage, ManagementRecord, ManagementReceipt } from './hosted-contract.mjs';
import type { MemoryControllerPorts } from './controller.mjs';
import type { ResetPreview } from './LearnedMemoryList';
export function createHostedMemoryHttp(ports:{dashboardFetch:(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;base:string}):Readonly<{
  loadBinding(s:HostedSelection,signal?:AbortSignal):Promise<HostedBinding>;
  forBinding(b:HostedBinding,options?:{signal?:AbortSignal}):Readonly<{
    rejectedBeforeDispatch(error:unknown):boolean;
    controller:MemoryControllerPorts['api']; inspect(offset?:number,limit?:number):Promise<InspectionPage>;
    previewReset():Promise<ResetPreview>;manage(r:ManagementRecord):Promise<ManagementReceipt>;
    managementOperation(r:ManagementRecord):Promise<ManagementReceipt>;
  }>;
}>;
