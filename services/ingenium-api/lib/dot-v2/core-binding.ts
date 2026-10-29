import type { Actor, Authorization, DotScope, Followup, Operation } from "../../../../packages/veyra-automation/contracts.js";
import { DotRepository, scopeKey, type Database } from "./repository.js";
import { DotService, DotError, type BoundJob } from "./service.js";

export interface CoreJob {
  id:string;project_id:string;organization_id:string;owner_kind:"user"|"organization";owner_user_id?:string|null;
  service_principal_id:string;agent:string;prompt_template:string;timeout_minutes:number;
  revision:number;schedule_revision:number;enabled:boolean;schedule_cron?:string|null;
}
export interface CoreRun {
  id:string;job_id:string;project_id:string;organization_id:string;
  effective_service_principal_id:string;job_revision:number;schedule_revision?:number|null;
  scheduled_for?:string|null;status:"queued"|"running"|"success"|"failed"|"timeout"|"cancelled";
}
export interface CoreDotPorts {
  getDb():Database & {inTransaction:boolean};
  execTransaction<T>(fn:()=>T,retries?:number):T;
  checkpointAfterWrite():void;
  jobs:{
    getJob(projectId:string,id:string):CoreJob|undefined;
    getJobRun(projectId:string,id:string):CoreRun|undefined;
    startJobRun(projectId:string,id:string,trigger:"cron",provenance:{scheduledFor:string;expectedScheduleRevision:number}):CoreRun|{reason:string};
    cancelJobRun(projectId:string,id:string):unknown;
    isJobRunAuthorizationCurrent(projectId:string,id:string):boolean;
  };
}
export interface CoreDotBindingPolicy {
  authorizeJob(actor:Actor,scope:DotScope,job:CoreJob,action:"read"|"dispatch"): {scope:DotScope;capabilities:string[]};
  authorizeRun(actor:Actor,scope:DotScope,run:CoreRun,action:"read"|"cancel"):void;
}
export interface CoreDotExecution {
  executeJobRun(runId:string,job:CoreJob,prompt:string):Promise<void>;
  requestCancellation(scope:DotScope,run:CoreRun):void;
  inspectOwnedRun(scope:DotScope,run:CoreRun):"running"|"success"|"failed"|"cancelled"|"unknown";
}
export interface CoreDotOptions {
  nestedCheckpointPolicy:"deferred-by-core-v1";
  now():string;id():string;
  onDiagnostic(event:{phase:string;code:string;runId?:string;error?:unknown}):void;
}
export interface CoreDotRuntime {
  service:DotService;
  ownsJob(projectId:string,jobId:string):boolean;
  dispatchJob(projectId:string,jobId:string,isActive:()=>boolean):Promise<void>;
  recoverOperations(limit?:number):number;
}

/** Inject the existing API singleton; this factory does not open another database or start a timer. */
export function createCoreDotRuntime(core:CoreDotPorts,authorization:Authorization,binding:CoreDotBindingPolicy,execution:CoreDotExecution,options:CoreDotOptions):CoreDotRuntime {
  if(options.nestedCheckpointPolicy!=="deferred-by-core-v1")throw new DotError("DOT_CORE_CHECKPOINT_PREREQUISITE");
  const db=core.getDb();
  const sameConnection=()=>{if(core.getDb()!==db)throw new DotError("DOT_DATABASE_REPLACED");};
  const transaction=<T,>(fn:()=>T):T=>{
    sameConnection();
    if(db.inTransaction)throw new DotError("DOT_OUTER_TRANSACTION_UNSUPPORTED");
    const result=core.execTransaction(fn,1);
    if(db.inTransaction)throw new DotError("DOT_COMMIT_UNCONFIRMED");
    try{core.checkpointAfterWrite();}catch(error){options.onDiagnostic({phase:"checkpoint",code:"DOT_POST_COMMIT_CHECKPOINT_FAILED",error});}
    return result;
  };
  const repository=new DotRepository({prepare(sql){sameConnection();return db.prepare(sql);}},transaction);
  const actorFor=(scope:DotScope):Actor=>({id:scope.ownerUserId,organizationId:scope.organizationId});
  const knownRun=(scope:DotScope,id:string):CoreRun=>{
    sameConnection();
    if(!scope.projectId)throw new DotError("DOT_PROJECTLESS_UNBOUND");
    const row=db.prepare("SELECT body FROM veyra_dot_records WHERE kind='operation' AND scope_key=? AND json_extract(body,'$.runId')=? LIMIT 1").get(scopeKey(scope),id) as {body:string}|undefined;
    const op=row?JSON.parse(row.body) as Operation:undefined;
    const followup=op?repository.get<Followup>("followup",op.followupId,scope):undefined;
    const run=core.jobs.getJobRun(scope.projectId,id);
    if(!op||!followup||!run||run.id!==id||run.job_id!==followup.jobId||run.project_id!==scope.projectId||run.organization_id!==scope.organizationId)throw new DotError("DOT_RUN_BINDING_CHANGED");
    return run;
  };
  const admitted=new WeakMap<BoundJob,{job:CoreJob;actor:Actor}>();
  const readJob=(actor:Actor,scope:DotScope,id:string,action:"read"|"dispatch")=>{
    sameConnection();
    if(!scope.projectId)throw new DotError("DOT_PROJECTLESS_UNBOUND");
    const job=core.jobs.getJob(scope.projectId,id);
    if(!job||job.project_id!==scope.projectId||job.organization_id!==scope.organizationId||(job.owner_kind==="user"&&job.owner_user_id!==scope.ownerUserId))throw new DotError("DOT_JOB_BINDING_CHANGED");
    const admission=binding.authorizeJob(actor,scope,job,action);
    if(scopeKey(admission.scope)!==scopeKey(scope))throw new DotError("DOT_JOB_BINDING_CHANGED");
    return {job,admission};
  };
  const service=new DotService(repository,authorization,{
    readAuthorizedJob(actor,scope,id){
      const {job,admission}=readJob(actor,scope,id,"read");
      const bound:BoundJob={id:job.id,revision:job.revision,scheduleRevision:job.schedule_revision,scope:admission.scope,prompt:job.prompt_template,enabled:job.enabled,cron:job.schedule_cron??null,capabilities:admission.capabilities};
      admitted.set(bound,{job,actor});return bound;
    },
    claim(bound,scheduledFor,toolPolicy){
      const receipt=admitted.get(bound);
      if(!receipt||toolPolicy!=="existing-grants-only"||!db.inTransaction)throw new DotError("DOT_CLAIM_NOT_ADMITTED");
      const {job:current}=readJob(receipt.actor,bound.scope,bound.id,"dispatch");
      if(current.revision!==bound.revision||current.schedule_revision!==bound.scheduleRevision)throw new DotError("DOT_JOB_BINDING_CHANGED");
      const claim=core.jobs.startJobRun(current.project_id,current.id,"cron",{scheduledFor,expectedScheduleRevision:bound.scheduleRevision});
      if("id" in claim)return {runId:claim.id};
      return {blocked:claim.reason,retryable:["Job already has a running or queued run","Automation concurrency quota is full"].includes(claim.reason)};
    },
    requestCancellation(scope,id){const run=knownRun(scope,id);binding.authorizeRun(actorFor(scope),scope,run,"cancel");execution.requestCancellation(scope,run);},
    inspect(scope,id){const run=knownRun(scope,id);binding.authorizeRun(actorFor(scope),scope,run,"read");return execution.inspectOwnedRun(scope,run);},
  },options.now,options.id);
  const followupForJob=(projectId:string,jobId:string):Followup|undefined=>{
    sameConnection();
    const row=db.prepare("SELECT body FROM veyra_dot_records WHERE kind='followup' AND json_extract(body,'$.jobId')=? AND json_extract(body,'$.scope.projectId')=? AND json_extract(body,'$.state')!='cancelled' LIMIT 1").get(jobId,projectId) as {body:string}|undefined;
    return row?JSON.parse(row.body) as Followup:undefined;
  };
  const markUnknown=(op:Operation,error:unknown)=>{
    const current=repository.get<Operation>("operation",op.id,op.scope);
    if(current&&current.runId===op.runId&&!["success","failed","cancelled"].includes(current.state))repository.put("operation",{...current,state:current.state==="cancel_requested"?"cancel_requested":"unknown",code:current.code??"DOT_LAUNCH_OUTCOME_UNKNOWN",revision:current.revision+1,updatedAt:options.now()},current.revision);
    options.onDiagnostic({phase:"launch",code:"DOT_LAUNCH_OUTCOME_UNKNOWN",runId:op.runId??undefined,error});
  };
  const notify=(scope:DotScope,id:string)=>{
    try{service.notify(actorFor(scope),scope,id,false);}
    catch(error){options.onDiagnostic({phase:"notify",code:"DOT_NOTIFICATION_BLOCKED",error});}
  };
  let recoveryCursor="";
  const recoveryDiagnostics=new Map<string,string>();
  const recoverableDenials=new Set(["DOT_FORBIDDEN","DOT_MEMORY_DISABLED","DOT_SOURCE_REVOKED","DOT_RUN_AUTHORIZATION_REVOKED","DOT_JOB_BINDING_CHANGED","DOT_RUN_BINDING_CHANGED","DOT_PROJECTLESS_UNBOUND","DOT_NOT_FOUND"]);
  return {
    service,
    ownsJob:(projectId,id)=>!!followupForJob(projectId,id),
    async dispatchJob(projectId,id,isActive){
      if(!isActive())return;
      const followup=followupForJob(projectId,id);if(!followup)return;
      const actor=actorFor(followup.scope);
      const result=service.reconcile(actor,followup.scope,followup.id);
      // reconcile returned only after the same-connection core and Dot writes committed.
      for(const op of result.operations){
        if(op.state!=="claimed"||!op.runId){notify(op.scope,op.id);continue;}
        let job:CoreJob;
        try{
          const run=knownRun(op.scope,op.runId);
          if(!isActive())throw new DotError("DOT_SCHEDULER_STOPPED");
          authorization.require(actor,op.scope,"dispatch",followup.capabilities);
          service.get(actor,op.scope,"suggestion",followup.suggestionId);
          const current=repository.get<Followup>("followup",followup.id,op.scope);
          if(!current||current.state!=="active"||current.jobId!==id)throw new DotError("DOT_FOLLOWUP_NOT_ACTIVE");
          job=readJob(actor,op.scope,id,"dispatch").job;
          if(job.revision!==run.job_revision||job.schedule_revision!==run.schedule_revision||job.service_principal_id!==run.effective_service_principal_id||!core.jobs.isJobRunAuthorizationCurrent(projectId,run.id))throw new DotError("DOT_RUN_AUTHORIZATION_REVOKED");
        }catch(error){
          // No launcher was called: only this newly claimed, exact run may be cancelled.
          options.onDiagnostic({phase:"pre-launch",code:"DOT_LAUNCH_NOT_STARTED",runId:op.runId,error});
          try{
            const run=knownRun(op.scope,op.runId);core.jobs.cancelJobRun(run.project_id,run.id);
            const confirmed=core.jobs.getJobRun(run.project_id,run.id);
            const current=repository.get<Operation>("operation",op.id,op.scope);
            if(current&&current.runId===run.id)repository.put("operation",{...current,state:confirmed?.status==="cancelled"?"cancelled":"unknown",code:"DOT_LAUNCH_NOT_STARTED",revision:current.revision+1,updatedAt:options.now()},current.revision);
          }catch(abortError){options.onDiagnostic({phase:"pre-launch-abort",code:"DOT_UNLAUNCHED_RUN_UNRESOLVED",runId:op.runId,error:abortError});}
          continue;
        }
        try{await execution.executeJobRun(op.runId,job,job.prompt_template);}
        catch(error){markUnknown(op,error);notify(op.scope,op.id);}
      }
    },
    recoverOperations(limit=100){
      sameConnection();if(!Number.isInteger(limit)||limit<1||limit>100)throw new DotError("DOT_VALIDATION");
      const page=()=>db.prepare("SELECT id,body FROM veyra_dot_records WHERE kind='operation' AND id>? AND json_extract(body,'$.runId') IS NOT NULL AND json_extract(body,'$.state') IN ('claimed','running','cancel_requested','unknown') ORDER BY id LIMIT ?").all(recoveryCursor,limit) as {id:string;body:string}[];
      let rows=page();
      if(!rows.length && recoveryCursor){recoveryCursor="";rows=page();}
      if(rows.length)recoveryCursor=rows[rows.length-1]!.id;
      for(const row of rows){
        const op=JSON.parse(row.body) as Operation;
        try{
          service.recoverOperation(actorFor(op.scope),op.scope,op.id);
          recoveryDiagnostics.delete(op.id);
        }catch(error){
          if(!(error instanceof DotError) || !recoverableDenials.has(error.code))throw error;
          if(recoveryDiagnostics.get(op.id)!==error.code){
            options.onDiagnostic({phase:"recovery",code:"DOT_RECOVERY_OPERATION_BLOCKED",runId:op.runId??undefined,error});
            recoveryDiagnostics.delete(op.id);recoveryDiagnostics.set(op.id,error.code);
            if(recoveryDiagnostics.size>100)recoveryDiagnostics.delete(recoveryDiagnostics.keys().next().value!);
          }
          continue;
        }
        notify(op.scope,op.id);
      }
      return rows.length;
    },
  };
}
