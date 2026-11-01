export {ProjectError,requireValue} from '../../../../packages/veyra-projects/domain.mjs';
import type {OwnerScope,ProjectRef,WorkspaceRoot} from "../../../../packages/veyra-projects/contracts.js";
export interface DatabasePort {
  prepare(sql:string):{
    get(...values:unknown[]):any;
    all(...values:unknown[]):any[];
    iterate(...values:unknown[]):Iterable<any>;
    run(...values:unknown[]):{changes:number|bigint};
  };
}
export interface CatalogDependencies {
  db:DatabasePort;
  transaction:<T>(action:()=>T)=>T;
  checkpointAfterWrite:()=>void;
  authorize:(scope:OwnerScope,action:string,target:string|WorkspaceRoot|null)=>boolean;
}
export class ProjectCatalog {
  constructor(dependencies:CatalogDependencies);
  get(scope:OwnerScope,id:string):ProjectRef;
  list(scope:OwnerScope,page?:{after?:string;limit?:number;archived?:boolean}):{
    data:ProjectRef[];pagination:{hasMore:boolean;cursor:string};
  };
  create(scope:OwnerScope,draft:{label:string;roots:WorkspaceRoot[]},id?:string):ProjectRef;
  bindImportedRoots(scope:OwnerScope,id:string,expectedRevision:number,roots:WorkspaceRoot[]):ProjectRef;
  update(scope:OwnerScope,id:string,expectedRevision:number,
    patch:{label?:string;pinned?:boolean;archived?:boolean}):ProjectRef;
}
