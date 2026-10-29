export function selectProject(selection, projectId) {
  return selection.projectId === projectId ? selection : {projectId, bindingId: null};
}
export function executionChoices(choices, projectId) {
  return choices.filter(choice => choice.projectId === projectId);
}
export function selectionStatus({selection, projects, choices, loading = false}) {
  if (loading) return {ready:false,reason:"Loading projects and execution targets…"};
  if (selection.projectId !== null &&
    !projects.some(project => project.id === selection.projectId && project.archivedAt === null && project.archived !== true))
    return {ready:false,reason:"The selected project is unavailable. Select a project explicitly."};
  const target = executionChoices(choices, selection.projectId)
    .find(choice => choice.binding.id === selection.bindingId);
  if (!target) return {ready:false,reason:"Select an execution target."};
  if (!target.available) return {ready:false,reason:target.reason ?? "The selected host is unavailable."};
  return {ready:true,reason:null};
}
