import type {OwnerScope,ProjectRef,ExecutionBinding} from "../../../../packages/veyra-projects/contracts.js";
import type {ExecutionAdmission} from "../../../../packages/veyra-projects/domain.mjs";
import type {DatabasePort} from "./catalog.mjs";
export type WorkspaceAction = "terminal.open"|"terminal.input"|"terminal.resize"|"terminal.close"|
  "project.action"|"git.status"|"git.diff"|"worktree.create"|"worktree.attach"|"worktree.archive"|"worktree.restore";
export interface ExecutionRequest {
  operationId:string;projectId:string|null;binding:ExecutionBinding;action:WorkspaceAction;args?:Record<string,unknown>;
}
export interface OperationReceipt {
  operationId:string;state:"pending"|"succeeded"|"failed"|"unknown";result:unknown;
}
export interface ExecutionDependencies {
  db:DatabasePort;transaction:<T>(action:()=>T)=>T;checkpointAfterWrite:()=>void;
  catalog:{get(scope:OwnerScope,id:string):ProjectRef|Promise<ProjectRef>};
  resolveAdmission:(scope:OwnerScope,request:{projectId:string|null;bindingId:string;action:string;
    args:Record<string,unknown>})=>Promise<ExecutionAdmission>;
  readOperation?:(request:{scope:OwnerScope;projectId:string|null;binding:ExecutionBinding;action:WorkspaceAction;
    args:Record<string,unknown>;operationId:string;requestHash:string})=>Promise<{state:"pending"|"succeeded"|"failed"|"unknown";result:unknown}>;
  dispatch:(request:{scope:OwnerScope;projectId:string|null;binding:ExecutionBinding;action:WorkspaceAction;
    args:Record<string,unknown>;operationId:string})=>Promise<{state:"succeeded"|"failed"|"unknown";result:unknown}>;
}
export class ExecutionOperations {
  constructor(dependencies:ExecutionDependencies);
  execute(scope:OwnerScope,request:ExecutionRequest):Promise<OperationReceipt>;
  reconcile(scope:OwnerScope,request:ExecutionRequest):Promise<OperationReceipt>;
}
