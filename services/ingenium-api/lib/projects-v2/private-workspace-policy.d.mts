export interface PrivateActor {ownerKey:string;authorityEpoch:number;}
export interface PrivateWorkspaceRecord {
  id:string;ownerKey:string;revision:number;state:"pending"|"active"|"unknown"|"failed"|"retired";
  environment:{kind:"windows"}|{kind:"wsl";distro:string;user:string};
  directory:string|null;rootIdentity:string|null;
}
export interface PrivateWorkspaceCreate {
  requestId:string;workspaceId:string;environment:PrivateWorkspaceRecord["environment"];
  serviceInstanceId:string;authorityEpoch:number;
}
export type PrivateOperation =
  {kind:"terminal_open";shell:string;columns:number;rows:number} |
  {kind:"terminal_input";terminalId:string;text:string} |
  {kind:"terminal_resize";terminalId:string;columns:number;rows:number} |
  {kind:"terminal_close";terminalId:string} |
  {kind:"agent_turn";conversationRef:string;originalTurnRef:string};
export interface PrivateWorkspaceOriginal {
  projectId:null;workspaceId:string;expectedRevision:number;serviceInstanceId:string;
  authorityEpoch:number;requestId:string;operation:PrivateOperation;
}
export interface PrivateReceipt {
  projectId:null;workspaceId:string;requestId:string;workspaceRevision:number;serviceInstanceId:string;
  authorityEpoch:number;originalSha256:string;state:"pending"|"succeeded"|"failed"|"unknown";resultRef:string|null;
}
export interface PrivateWorkspaceView {
  projectId:null;id:string;revision:number;state:PrivateWorkspaceRecord["state"];
  environment:PrivateWorkspaceRecord["environment"];serviceInstanceId:string;authorityEpoch:number;
  directory:string|null;rootIdentity:string|null;
}
export interface CapturedPrivateWorkspace {
  workspaceId:string;ownerKey:string;directory:string;rootIdentity:string;
  verify():boolean|Promise<boolean>;
}
export interface PrivateWorkspacePorts {
  owner:{
    reserveCreate(actor:PrivateActor,original:PrivateWorkspaceCreate,hash:string):
      {fresh:boolean;record:PrivateWorkspaceRecord}|Promise<{fresh:boolean;record:PrivateWorkspaceRecord}>;
    get(actor:PrivateActor,id:string):PrivateWorkspaceRecord|Promise<PrivateWorkspaceRecord>;
    activate(actor:PrivateActor,id:string,proof:{directory:string;rootIdentity:string}):
      PrivateWorkspaceRecord|Promise<PrivateWorkspaceRecord>;
    markUnknown(actor:PrivateActor,id:string):PrivateWorkspaceRecord|Promise<PrivateWorkspaceRecord>;
    reserveOperation(actor:PrivateActor,record:PrivateWorkspaceRecord,original:PrivateWorkspaceOriginal,hash:string):
      {fresh:boolean;receipt:PrivateReceipt}|Promise<{fresh:boolean;receipt:PrivateReceipt}>;
    settleOperation(actor:PrivateActor,id:string,state:PrivateReceipt["state"],resultRef:string|null):
      PrivateReceipt|Promise<PrivateReceipt>;
    readOperation(actor:PrivateActor,workspaceId:string,requestId:string):PrivateReceipt|Promise<PrivateReceipt>;
  };
  custody:{
    supports(environment:PrivateWorkspaceRecord["environment"]):boolean;
    prepareOnce(input:{actor:PrivateActor;original:PrivateWorkspaceCreate}):Promise<CapturedPrivateWorkspace>;
    acquireExisting(input:{actor:PrivateActor;record:PrivateWorkspaceRecord}):Promise<CapturedPrivateWorkspace>;
  };
  execution:{
    supports(kind:PrivateOperation["kind"],environment:PrivateWorkspaceRecord["environment"]):boolean;
    executeOnce(input:{lease:CapturedPrivateWorkspace;actor:PrivateActor;original:PrivateWorkspaceOriginal;
      verifyNow:()=>Promise<void>}):Promise<{state:"succeeded"|"failed"|"unknown";resultRef:string|null}>;
  };
  authorize(context:unknown,action:string,workspaceId:string|null):Promise<PrivateActor>;
  serviceInstanceId:string;
}
export class PrivateWorkspaceBoundary {
  constructor(ports:PrivateWorkspacePorts);
  create(context:unknown,request:PrivateWorkspaceCreate):Promise<PrivateWorkspaceView>;
  reconnect(context:unknown,workspaceId:string):Promise<PrivateWorkspaceView>;
  execute(context:unknown,request:PrivateWorkspaceOriginal):Promise<PrivateReceipt>;
  receipt(context:unknown,workspaceId:string,requestId:string):Promise<PrivateReceipt>;
}
export function privateWorkspaceFingerprint(value:unknown):string;
