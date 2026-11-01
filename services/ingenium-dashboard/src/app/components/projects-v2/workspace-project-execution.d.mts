import type {ProjectRef} from '../../../../../../packages/veyra-projects/contracts.js';
import type {ConfirmedWorkspaceExecution,WorkspaceExecutionOption} from './workspace-execution-client.mjs';
export function workspaceProjectMatchesExecution(project:ProjectRef,execution:ConfirmedWorkspaceExecution|null|undefined):boolean;
export function confirmWorkspaceProjectExecution(client:{list():Promise<WorkspaceExecutionOption[]>;confirm(row:WorkspaceExecutionOption):Promise<ConfirmedWorkspaceExecution>},project:ProjectRef):Promise<ConfirmedWorkspaceExecution>;
