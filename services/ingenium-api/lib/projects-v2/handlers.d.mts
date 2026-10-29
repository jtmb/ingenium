import type {Request,RequestHandler} from "express";
import type {OwnerScope,ProjectRef,WorkspaceRoot} from "../../../../packages/veyra-projects/contracts.js";
export function createProjectHandlers(dependencies:{
  resolveScope:(req:Request)=>OwnerScope|null|Promise<OwnerScope|null>;
  catalog:{
    get(scope:OwnerScope,id:string):ProjectRef|Promise<ProjectRef>;
    list(scope:OwnerScope,page:{after:string;limit:number;archived:boolean}):unknown;
    create(scope:OwnerScope,draft:{label:string;roots:WorkspaceRoot[]},id:string):ProjectRef|Promise<ProjectRef>;
    update(scope:OwnerScope,id:string,revision:number,patch:unknown):ProjectRef|Promise<ProjectRef>;
  };
  operations:{execute(scope:OwnerScope,request:unknown):Promise<{operationId:string;state:string;result:unknown}>;
    reconcile(scope:OwnerScope,request:unknown):Promise<{operationId:string;state:string;result:unknown}>};
}):Record<"list"|"get"|"create"|"update"|"execute"|"reconcile",RequestHandler>;
