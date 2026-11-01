import type {ProjectRef}from'../../../../../../packages/veyra-projects/contracts.js';
import type {ConfirmedWorkspaceExecution}from'./workspace-execution-client.mjs';
import type {WorkspaceProjectClient}from'./workspace-project-catalog.mjs';
export interface WorkspaceProjectCreationIntent {version:1;id:string;label:string;execution:ConfirmedWorkspaceExecution}
export interface WorkspaceProjectCreationJournal {read():WorkspaceProjectCreationIntent|null;begin(label:string,execution:ConfirmedWorkspaceExecution):WorkspaceProjectCreationIntent;finish(id:string):void}
export function projectCreationExecution(value:ConfirmedWorkspaceExecution,scope:{ownerUserId:string;organizationId:string}):ConfirmedWorkspaceExecution;
export function createWorkspaceProjectCreationJournal(storage:Pick<Storage,'getItem'|'setItem'>,scope:{ownerUserId:string;organizationId:string}):WorkspaceProjectCreationJournal;
export function createWorkspaceProjectCreationController(client:WorkspaceProjectClient,journal:WorkspaceProjectCreationJournal):{submit(label:string,execution:ConfirmedWorkspaceExecution):Promise<ProjectRef>;recover():Promise<ProjectRef>;resume(execution:ConfirmedWorkspaceExecution):Promise<ProjectRef>;pending():WorkspaceProjectCreationIntent|null};
export function sameProjectCreationExecution(intent:WorkspaceProjectCreationIntent|null,execution:ConfirmedWorkspaceExecution|null):boolean;
