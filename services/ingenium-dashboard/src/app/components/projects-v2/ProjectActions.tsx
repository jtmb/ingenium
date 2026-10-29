"use client";

import type {ProjectAction, WorktreeView} from "../../../../../../packages/veyra-projects/contracts";

export function ProjectActions({actions, worktrees, pending, error, canCreateWorktree, canAttachWorktree, onRun, onCreateWorktree, onAttachWorktree,
  onArchiveWorktree, onRestoreWorktree}: {
  actions: ProjectAction[];
  canCreateWorktree: boolean;
  canAttachWorktree: boolean;
  worktrees: WorktreeView[];
  pending: boolean;
  error: string | null;
  onRun: (actionId: string) => void;
  onCreateWorktree: () => void;
  onAttachWorktree: () => void;
  onArchiveWorktree: (id: string, revision: number) => void;
  onRestoreWorktree: (id: string, revision: number) => void;
}) {
  return <section aria-label="Project actions and worktrees" className="flex flex-col gap-3" data-testid="project-actions">
    <div className="flex flex-wrap gap-2">
      {actions.map(action=><button key={action.id} type="button" disabled={pending || !action.enabled}
        title={action.disabledReason} onClick={()=>onRun(action.id)}
        className="rounded border border-current px-3 py-2">{action.label}</button>)}
      {actions.length===0 && <p className="text-sm">No run, build, test or setup actions configured for this target.</p>}
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={pending || !canCreateWorktree} onClick={onCreateWorktree} className="rounded border border-current px-3 py-2">
        New worktree
      </button>
      <button type="button" disabled={pending || !canAttachWorktree} onClick={onAttachWorktree} className="rounded border border-current px-3 py-2">
        Attach worktree
      </button>
    </div>
    {worktrees.length===0 ? <p className="text-sm">No attached worktrees.</p> : <ul className="flex flex-col gap-2">
      {worktrees.map(tree=><li key={tree.id} className="flex flex-wrap items-center gap-2 rounded border border-current p-2">
        <span className="min-w-0 flex-1 break-words">{tree.label} · {tree.state}</span>
        <button type="button" disabled={pending || !tree.canArchive} title={tree.reason}
          onClick={()=>onArchiveWorktree(tree.id,tree.revision)} className="rounded border border-current px-3 py-1">
          Archive
        </button>
        <button type="button" disabled={pending || !tree.canRestore} title={tree.reason}
          onClick={()=>onRestoreWorktree(tree.id,tree.revision)} className="rounded border border-current px-3 py-1">
          Restore
        </button>
      </li>)}
    </ul>}
    {error && <p role="alert" className="text-sm">{error}</p>}
  </section>;
}
