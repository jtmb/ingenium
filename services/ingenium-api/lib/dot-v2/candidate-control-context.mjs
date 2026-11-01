/** Negative-only API context backed by the original Core candidate ledger.
 * No current source/image approval, execute brand or physical proof is minted. */
import {getDb,dotExecutionDelegation} from 'ingenium-core';
import {parseStrictJobJson} from './job-bootstrap-frame.mjs';
const originals=new WeakMap(),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=()=>{throw Object.assign(Error('CANDIDATE_CONTROL_CONTEXT_UNAVAILABLE'),{code:'CANDIDATE_CONTROL_CONTEXT_UNAVAILABLE',status:503})};
const need=value=>{if(!value)fail()};
const selection=b=>({runId:b.runId,projectId:b.projectId,runtimeId:b.runtimeId,workspaceId:b.workspaceId});
function validate(context,binding){
 const state=originals.get(context);need(state);need(state.db===getDb());
 const facts=dotExecutionDelegation.requireCandidateDotControlOriginal(state.original,selection(state.binding));
 need(facts.runIdentityHash===state.binding.runIdentityHash&&facts.scope.organizationId===state.binding.organizationId&&facts.scope.ownerUserId===state.binding.ownerUserId);
 need(binding&&Object.entries(state.binding).every(([key,value])=>binding[key]===value));return state;
}
/** The only input selects one existing original run. Core revalidates the
 * operation, immutable admission, purpose, owner, workspace and lifecycle. */
export function createOriginalCandidateControlContext(runId){
 need(arguments.length===1&&typeof runId==='string'&&uuid.test(runId));
 const db=getDb(),row=db.prepare('SELECT run_id,project_id,job_id,runtime_id,workspace_id,run_identity_hash,admission_json,purpose,candidate_waiting_protocol FROM job_run_managed_execution WHERE run_id=?').get(runId);
 need(row?.purpose==='candidate-inert-v1'&&row.candidate_waiting_protocol==='original-candidate-waiting-v1');
 const operations=db.prepare("SELECT id,body FROM veyra_dot_records WHERE kind='operation' AND json_extract(body,'$.runId')=? LIMIT 2").all(runId);need(operations.length===1);
 const op=parseStrictJobJson(Buffer.from(operations[0].body),65536);need(op.id===operations[0].id&&typeof op.followupId==='string'&&op.runId===runId);
 const original=dotExecutionDelegation.acquireCandidateDotControlOriginal({followupId:op.followupId,operationId:op.id,runId});
 const admission=parseStrictJobJson(Buffer.from(row.admission_json),65536),binding={};
 for(const key of ['runId','attemptId','candidateIntentHash','specHash','selectionSha256','deadlineAt','organizationId','ownerUserId','projectId','jobId','runtimeId','parentContainerId','workspaceId','bindingHash','bindingEpoch','daemonId','imageId']){need(Object.hasOwn(admission,key));binding[key]=admission[key]}
 Object.assign(binding,{runIdentityHash:row.run_identity_hash,deadlineMs:Date.parse(admission.deadlineAt)});need(Number.isFinite(binding.deadlineMs)&&binding.runId===runId&&binding.projectId===row.project_id&&binding.jobId===row.job_id&&binding.runtimeId===row.runtime_id&&binding.workspaceId===row.workspace_id&&getDb()===db);
 const context=Object.freeze({});originals.set(context,{db,original,binding:Object.freeze(binding)});validate(context,binding);return context;
}
/** A copied context, ordinary approved execution context or row DTO is refused. */
export function requireOriginalCandidateControlContext(context,binding){validate(context,binding)}
