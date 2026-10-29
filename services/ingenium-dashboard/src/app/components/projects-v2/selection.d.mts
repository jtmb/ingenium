import type {WorkspaceSelection, ProjectRef, ExecutionChoice} from "../../../../../../packages/veyra-projects/contracts";
export function selectProject(selection: WorkspaceSelection, projectId: string | null): WorkspaceSelection;
export function executionChoices(choices: ExecutionChoice[], projectId: string | null): ExecutionChoice[];
export function selectionStatus(input: {selection: WorkspaceSelection; projects: ProjectRef[];
  choices: ExecutionChoice[]; loading?: boolean}): {ready: boolean; reason: string | null};
