import {getDb,jobs,agents,jobProviders,runtimes,contextConversations,trustedJobEvents} from "ingenium-core";
import {inspectManagedRuntimePlacement} from "../runtime-manager-client.js";
import {qualifyManagedRuntimePlacement} from "../runtime-placement-contract.js";
import {findRequestChatSourceIds,isRequestChatConversationActive} from "../projects-v2/request-chat-source.mjs";
import {dotExecutionFingerprint,dotEventDigest,dotSourceReference} from "./request-binding.js";
import {originalJobRunIdentity} from "./core126-owner.mjs";
import {scopeKey} from "./repository.js";
import {createOriginalDotJobPolicy} from "./dot-job-policy.mjs";
import {createOriginalDotApprovedScopeReader,type OriginalDotApprovalLease} from "./dot-approved-scope.mjs";
/** No HTTP request/session/cookie/token is retained by this read-only owner. */
export const installedDotApprovedScopeReader=createOriginalDotApprovedScopeReader({getDb,jobs,runtimes,contextConversations,trustedJobEvents,
 jobPolicy:createOriginalDotJobPolicy({getDb,jobs,agents,jobProviders}),scopeKey,
 parseReference(value){const parsed=JSON.parse(value) as Parameters<typeof dotSourceReference>[0];if(dotSourceReference(parsed)!==value)throw Error("DOT_SOURCE_REVOKED");return parsed;},
 inspectPlacement:inspectManagedRuntimePlacement,qualifyPlacement:qualifyManagedRuntimePlacement,fingerprint:dotExecutionFingerprint,runIdentity:originalJobRunIdentity,eventDigest:dotEventDigest,now:Date.now,
 findSourceIds(execution,engineSessionId){if(!execution.projectId)throw Error("DOT_PROJECTLESS_UNBOUND");return findRequestChatSourceIds((sql,parameters)=>getDb().prepare<string[]>(sql).all(...parameters) as {id:string}[],{...execution,projectId:execution.projectId},engineSessionId);},
 conversationIsActive(projectId,contextId){return isRequestChatConversationActive((sql,parameters)=>getDb().prepare<string[]>(sql).get(...parameters) as {event_type:string}|undefined,projectId,contextId);},
});

/** Synchronous final-write revalidation: only a lease minted by the original reader is accepted. */
export const revalidateInstalledDotApproval=(lease:OriginalDotApprovalLease)=>installedDotApprovedScopeReader.revalidate(lease);
export const readInstalledDotOperationEvidence=(lease:OriginalDotApprovalLease,runId:string)=>installedDotApprovedScopeReader.operationEvidence(lease,runId);
