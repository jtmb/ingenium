export type Policy = {revision:number;enabled:boolean;generate:boolean;useMemory:boolean;externalContext:boolean};
export type ChatPolicy = {revision:number;useMemory:boolean;contribute:boolean};
export type Snapshot = {scopeKey:string;chatId:string;available:boolean;canChange:boolean;loading:boolean;pending:boolean;
 policy:Policy;chat:ChatPolicy;unknownOperationId?:string;error?:string};
export type Entry = {id:string;revision:number;content:string;model:string;created_ms:number;sources:unknown[]};
export function createNativeMemoryController(ports:{
 request:(method:"POST",path:string,body:unknown)=>Promise<unknown>;
 custody:{get:(scope:string)=>Promise<unknown>;set:(scope:string,record:unknown)=>Promise<void>;
 retain:(scope:string,id:string,receipt:unknown)=>Promise<void>;remove:(scope:string,id:string)=>Promise<void>};
 subject:unknown;chatId:string;newOperationId?:()=>string;
}):Readonly<{
 getSnapshot:()=>Snapshot;subscribe:(listener:()=>void)=>()=>void;dispose:()=>void;
 inspect:()=>Promise<{entries:Entry[]}>;
 change:(scope:string,chat:string,change:{target:"host"|"chat";expectedRevision:number;values:Policy|ChatPolicy})=>Promise<boolean>;
 forget:(entry:Entry)=>Promise<boolean>;reconcile:(operation:string)=>Promise<boolean>;
}>;
