import type {OwnerScope,ExecutionBinding} from "../../../../packages/veyra-projects/contracts.js";
import type {ExecutionDependencies} from "./execution.mjs";
export interface WorkspaceRead {
  projectId:string|null;binding:ExecutionBinding;kind:"terminals"|"output"|"actions"|"worktrees"|"git";
  args?:{terminalId?:string;afterSequence?:number;maxBytes?:number};
}
export class WorkspaceReads {
  constructor(dependencies:Pick<ExecutionDependencies,"catalog"|"resolveAdmission"> & {
    readOwner:(request:WorkspaceRead & {scope:OwnerScope})=>Promise<unknown>;
  });
  read(scope:OwnerScope,request:WorkspaceRead):Promise<unknown>;
}
