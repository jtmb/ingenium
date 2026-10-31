import type { HostedBinding, ManagementRecord } from './hosted-contract.mjs';
import type { MemoryControllerPorts } from './controller.mjs';
export interface JournalStorage { readonly length:number; key(i:number):string|null; getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem(k:string):void }
export function createHostedJournal(storage:JournalStorage,binding:HostedBinding):Readonly<{
  policy:MemoryControllerPorts['journal'];
  management:{ get():ManagementRecord|null;set(r:ManagementRecord):void;remove(id:string):void };
}>;
