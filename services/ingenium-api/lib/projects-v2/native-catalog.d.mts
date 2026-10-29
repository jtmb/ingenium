import type {OwnerScope,ProjectRef,WorkspaceRoot} from "../../../../packages/veyra-projects/contracts.js";
export interface NativeProjectDraft {
  name:string;environment:{kind:"windows"}|{kind:"wsl";distro:string;user:string|null};
  primary_root:string;roots:string[];
}
export interface NativeProject extends NativeProjectDraft {
  id:string;revision:number;archived:boolean;pinned:boolean;
}
interface NativeEnvelope {instanceId:string;project:NativeProject;}
export class NativeProjectCatalogAdapter {
  constructor(dependencies:{instanceId:string;
    authorize:(scope:OwnerScope,action:string,id:string|null)=>boolean|Promise<boolean>;
    resolveRoot:(scope:OwnerScope,request:{instanceId:string;project:NativeProject;directory:string})=>
      Promise<Omit<WorkspaceRoot,"displayPath"|"isPrimary"> & {directory:string}>;
    owner:{
      getProject(request:{scope:OwnerScope;projectId:string;expectedInstanceId:string}):Promise<NativeEnvelope>;
      listProjects(request:{scope:OwnerScope;after:string;limit:number;archived:boolean;expectedInstanceId:string}):
        Promise<{instanceId:string;projects:NativeProject[];next_cursor:string|null}>;
      createProject(request:{scope:OwnerScope;expectedInstanceId:string;
        request:{project_id:string;draft:NativeProjectDraft}}):Promise<NativeEnvelope>;
      updateProject(request:{scope:OwnerScope;projectId:string;expectedInstanceId:string;
        request:{expected_revision:number;name?:string;pinned?:boolean;archived?:boolean}}):Promise<NativeEnvelope>;
    };
  });
  get(scope:OwnerScope,id:string):Promise<ProjectRef>;
  list(scope:OwnerScope,page?:{after?:string;limit?:number;archived?:boolean}):Promise<{
    data:ProjectRef[];pagination:{hasMore:boolean;cursor:string|null};
  }>;
  create(scope:OwnerScope,draft:NativeProjectDraft,id:string):Promise<ProjectRef>;
  update(scope:OwnerScope,id:string,expectedRevision:number,patch:{label?:string;pinned?:boolean;archived?:boolean}):
    Promise<ProjectRef>;
}
