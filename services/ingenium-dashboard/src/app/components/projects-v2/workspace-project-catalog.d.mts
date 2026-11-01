import type {ConfirmedWorkspaceExecution}from'./workspace-execution-client.mjs';
import type {ProjectRef} from '../../../../../../packages/veyra-projects/contracts.js';
export interface WorkspaceProjectClient {create(id:string,label:string,execution:ConfirmedWorkspaceExecution):Promise<ProjectRef>;list(archived?:boolean):Promise<ProjectRef[]>;get(id:string):Promise<ProjectRef>;update(current:ProjectRef,patch:{label?:string;pinned?:boolean;archived?:boolean}):Promise<ProjectRef>}
export function createWorkspaceProjectClient(request:<T>(path:string,options?:RequestInit)=>Promise<T>,scope:{ownerUserId:string;organizationId:string}):WorkspaceProjectClient;
