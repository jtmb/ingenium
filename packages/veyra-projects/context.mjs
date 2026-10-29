import {requireValue, scopeKey, sameScope, validateBinding} from "./domain.mjs";

export function conversationWorkspace({scope, conversation, project, binding}) {
  scopeKey(scope); validateBinding(binding);
  requireValue(project === null || (project && typeof project === "object"));
  requireValue(conversation && sameScope(scope,conversation.scope),"FORBIDDEN",403);
  requireValue(Object.hasOwn(conversation,"projectId") && conversation.projectId !== undefined,
    "PROJECT_SELECTION_REQUIRED",422);
  requireValue(conversation.projectId === (project?.id ?? null),"CONVERSATION_PROJECT_MISMATCH",409);
  requireValue(project === null || sameScope(scope,project.scope),"FORBIDDEN",403);
  requireValue(conversation.bindingId === binding.id,"CONVERSATION_BINDING_MISMATCH",409);
  return {conversationId:conversation.id,projectId:conversation.projectId,bindingId:binding.id,
    ownerScope:{...scope},workspaceIdentity:binding.workspaceIdentity,
    hostId:binding.hostId,environmentId:binding.environmentId,securityEpoch:binding.securityEpoch};
}
