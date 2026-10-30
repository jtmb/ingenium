import type { Request } from "express";
import { authorization, contextConversations, explicitMemory, getDb, execTransaction, checkpointAfterWrite, jobs, jobEventDeliveries, trustedJobEvents } from "ingenium-core";
import { toAuthorizationPrincipal } from "../authorization-policy.js";
import { revalidateRequestIdentity } from "../request-identity.js";
import { resolveRequestExecution, resolveRequestChatBinding } from "../projects-v2/request-execution.js";
import { createRequestMemorySession } from "../memory-v2/request-session.js";
import { executeJobRun, killRunProcess } from "../job-runner.js";
import { createCoreDotRuntime, type CoreDotOptions } from "./core-binding.js";
import { DotError } from "./service.js";
import { scopeKey } from "./repository.js";
import { createRequestDotBinding, type DotRequestAuthorities, type DotRequestSelection, type QualifiedDotRequestRunner } from "./request-binding.js";

export type DotQualifiedRunnerOwner=Omit<QualifiedDotRequestRunner,"executeJobRun"|"killRunProcess"> & {requireCapabilities:DotRequestAuthorities["requireCapabilities"]};

/** Root supplies qualified placement/capability/settlement facts; all other adapters use existing owners. */
export function createCoreRequestDotBinding(request:Request,selected:DotRequestSelection,runner:DotQualifiedRunnerOwner) {
  return createRequestDotBinding(request,selected,{
    revalidateRequestIdentity,resolveRequestExecution,resolveRequestChatBinding,toAuthorizationPrincipal,
    requireProjectPermission:authorization.requireProjectPermission,
    requireCapabilities:(principal,execution,capabilities)=>runner.requireCapabilities(principal,execution,capabilities),
    getContextConversation:contextConversations.getContextConversation,
    getContextMessage:contextConversations.getContextMessage,
    getTrustedJobEvent:trustedJobEvents.getTrustedJobEvent,
    createRequestMemorySession,
    readExplicitMemory:explicitMemory.readExplicitMemory,
    jobs,
    bindings:{
      hasOtherLiveBinding(projectId,jobId,scope){return !!getDb().prepare("SELECT 1 FROM veyra_dot_records WHERE kind='followup' AND scope_key<>? AND json_extract(body,'$.scope.projectId')=? AND json_extract(body,'$.jobId')=? AND json_extract(body,'$.state')!='cancelled' LIMIT 1").get(scopeKey(scope),projectId,jobId);},
      hasJobBinding(projectId,jobId,scope){return !!getDb().prepare("SELECT 1 FROM veyra_dot_records WHERE kind='followup' AND scope_key=? AND json_extract(body,'$.scope.projectId')=? AND json_extract(body,'$.jobId')=? LIMIT 1").get(scopeKey(scope),projectId,jobId);},
      hasRunBinding(projectId,runId,jobId,scope){return !!getDb().prepare("SELECT 1 FROM veyra_dot_records op JOIN veyra_dot_records f ON f.kind='followup' AND f.id=json_extract(op.body,'$.followupId') AND f.scope_key=op.scope_key WHERE op.kind='operation' AND op.scope_key=? AND json_extract(op.body,'$.runId')=? AND json_extract(f.body,'$.jobId')=? AND json_extract(f.body,'$.scope.projectId')=? LIMIT 1").get(scopeKey(scope),runId,jobId,projectId);},
    },
    listJobEventDeliveries:jobEventDeliveries.listJobEventDeliveries,
    runner:{async executeJobRun(id,bound,prompt){
      const actual=jobs.getJob(bound.project_id,bound.id);
      if(!actual||actual.organization_id!==bound.organization_id||actual.revision!==bound.revision||actual.schedule_revision!==bound.schedule_revision||actual.service_principal_id!==bound.service_principal_id||actual.prompt_template!==prompt)throw new DotError("DOT_JOB_BINDING_CHANGED");
      await executeJobRun(id,actual,prompt);
    },killRunProcess,assertExecutionSupported:(execution,job)=>runner.assertExecutionSupported(execution,job),capabilitiesForJob:job=>runner.capabilitiesForJob(job),inspectSettlement:(execution,run)=>runner.inspectSettlement(execution,run)},
  });
}

/** HTTP-only session. Never retain its request identity for the autonomous scheduler. */
export function createCoreRequestDotSession(request:Request,selected:DotRequestSelection,runner:DotQualifiedRunnerOwner,options:CoreDotOptions) {
  const binding=createCoreRequestDotBinding(request,selected,runner);
  const runtime=createCoreDotRuntime({getDb,execTransaction,checkpointAfterWrite,jobs:{
    getJob:jobs.getJob,getJobRun:jobs.getJobRun,cancelJobRun:jobs.cancelJobRun,isJobRunAuthorizationCurrent:jobs.isJobRunAuthorizationCurrent,
    startJobRun(projectId,id,trigger,provenance){
      binding.context();
      const current=revalidateRequestIdentity(request);
      if(!current)throw new DotError("DOT_REQUEST_UNAUTHENTICATED");
      return jobs.startJobRun(projectId,id,trigger,{...provenance,sourceActor:{type:current.principal.type,id:current.principal.id}});
    },
  }},binding.authorization,binding.bindingPolicy,binding.execution,options);
  return {service:runtime.service,context:binding.context(),queue:binding.queue};
}
