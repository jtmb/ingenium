"use client";

import {useId} from "react";
import type {ExecutionChoice, ProjectRef, WorkspaceSelection}
  from "../../../../../../packages/veyra-projects/contracts";
import {executionChoices, selectProject, selectionStatus} from "./selection.mjs";

export function ProjectExecutionPicker({projects, choices, value, onChange, loading = false, error = null, disabled = false}: {
  projects: ProjectRef[];
  choices: ExecutionChoice[];
  value: WorkspaceSelection;
  onChange: (selection: WorkspaceSelection) => void;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
}) {
  const id = useId();
  const status = selectionStatus({selection:value,projects,choices,loading});
  const targets = executionChoices(choices,value.projectId);
  const missingProject = value.projectId !== null && !projects.some(p=>p.id===value.projectId && p.archivedAt===null && !p.archived);
  const missingBinding = value.bindingId !== null && !targets.some(c=>c.binding.id===value.bindingId);
  return <fieldset disabled={disabled || loading} className="flex min-w-0 flex-wrap items-start gap-3"
    aria-describedby={id+"-status"} data-testid="project-execution-picker">
    <legend className="sr-only">Project and execution target</legend>
    <label className="flex min-w-40 flex-col gap-1 text-sm" htmlFor={id+"-project"}>
      Project
      <select id={id+"-project"} value={value.projectId ?? ""} className="rounded-md border border-current bg-transparent p-2"
        onChange={event=>onChange(selectProject(value,event.target.value || null))}>
        <option value="">No project</option>
        {missingProject && <option value={value.projectId!} disabled>Selected project unavailable</option>}
        {projects.filter(p=>p.archivedAt===null && !p.archived).map(project=><option key={project.id} value={project.id}>
          {project.label}
        </option>)}
      </select>
    </label>
    <label className="flex min-w-48 flex-col gap-1 text-sm" htmlFor={id+"-target"}>
      Execution target
      <select id={id+"-target"} value={value.bindingId ?? ""} className="rounded-md border border-current bg-transparent p-2"
        onChange={event=>onChange({...value,bindingId:event.target.value || null})}>
        <option value="">Choose target</option>
        {missingBinding && <option value={value.bindingId!} disabled>Selected target unavailable</option>}
        {targets.map(choice=><option key={choice.binding.id} value={choice.binding.id} disabled={!choice.available}>
          {choice.label} · {choice.binding.kind}{choice.available ? "" : " · Unavailable"}
        </option>)}
      </select>
    </label>
    <p id={id+"-status"} className="w-full text-sm" role={error ? "alert" : "status"}>
      {error ?? status.reason ?? "Execution target selected"}
    </p>
  </fieldset>;
}
