import { createHash } from "node:crypto";
import type { Actor, Authorization, DotScope, Suggestion, Followup, Operation, Notification, Schedule, MissedPolicy } from "../../../../packages/veyra-automation/contracts.js";
import { DotRepository, DotConflict, scopeKey } from "./repository.js";
import { validateSchedule, planDue } from "./schedule.js";

export type SuggestionInput = Pick<Suggestion,"title"|"prompt"|"source"|"capabilities"|"expiresAt">;
export interface BoundJob {
  id: string; revision: number; scheduleRevision: number; scope: DotScope;
  prompt: string; enabled: boolean; cron: string | null; capabilities: string[];
}
export interface JobAuthority {
  readAuthorizedJob(actor: Actor, scope: DotScope, jobId: string): BoundJob;
  claim(job: BoundJob, scheduledFor: string, toolPolicy: "existing-grants-only"): { runId: string } | { blocked: string; retryable?: boolean };
  requestCancellation(scope: DotScope, runId: string): void;
  inspect(scope: DotScope, runId: string): "running" | "success" | "failed" | "cancelled" | "unknown";
}
export class DotError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code=code; }
}
const text = (value: string, max: number) => { if (typeof value !== "string" || !value.trim() || value.length > max) throw new DotError("DOT_VALIDATION"); };
function suggestionInput(input: SuggestionInput): SuggestionInput {
  if(!input || !input.source || !Array.isArray(input.capabilities) || input.capabilities.length>32)throw new DotError("DOT_VALIDATION");
  text(input.title,160);text(input.prompt,16000);text(input.source.reference,512);
  if(!["user","event","memory"].includes(input.source.kind))throw new DotError("DOT_VALIDATION");
  for(const capability of input.capabilities)text(capability,128);
  if(typeof input.expiresAt!=="string" || !Number.isFinite(Date.parse(input.expiresAt)) || new Date(input.expiresAt).toISOString()!==input.expiresAt)throw new DotError("DOT_VALIDATION");
  return {title:input.title,prompt:input.prompt,source:{kind:input.source.kind,reference:input.source.reference},capabilities:[...new Set(input.capabilities)],expiresAt:input.expiresAt};
}
const terminal = new Set(["success", "failed", "cancelled", "skipped", "blocked"]);

export class DotService {
  readonly repository: DotRepository; readonly authorization: Authorization; readonly jobs: JobAuthority; readonly now: () => string; readonly id: () => string;
  constructor(repository: DotRepository, authorization: Authorization, jobs: JobAuthority, now: () => string, id: () => string) { this.repository=repository; this.authorization=authorization; this.jobs=jobs; this.now=now; this.id=id; }
  private require(actor: Actor, scope: DotScope, action: Parameters<Authorization["require"]>[2], capabilities: string[] = []) {
    if (!actor || !scope || ![scope.organizationId,scope.ownerUserId,scope.executionBindingId,scope.executionBindingFingerprint].every(v => typeof v === "string" && v.length > 0) || !actor.id || actor.organizationId !== scope.organizationId || actor.id !== scope.ownerUserId) throw new DotError("DOT_FORBIDDEN");
    if ((scope.projectId !== null && (typeof scope.projectId !== "string" || !scope.projectId.length)) || (scope.conversationId !== null && (typeof scope.conversationId !== "string" || !scope.conversationId.length))) throw new DotError("DOT_FORBIDDEN");
    this.authorization.require(actor,scope,action,capabilities);
  }
  private suggestion(actor: Actor, scope: DotScope, id: string): Suggestion {
    const value = this.repository.get<Suggestion>("suggestion",id,scope);
    if (!value) throw new DotError("DOT_NOT_FOUND");
    if (value.source.kind === "memory" && !this.authorization.canReadMemory(actor,scope)) throw new DotError("DOT_MEMORY_DISABLED");
    this.authorization.requireSource(actor,scope,value.source);
    return value;
  }
  propose(actor: Actor, scope: DotScope, input: SuggestionInput): Suggestion {
    return this.createSuggestion(actor,scope,input);
  }
  assertCanSuggest(actor: Actor, scope: DotScope): void { this.require(actor,scope,"suggest"); }
  proposeForSource(actor: Actor, scope: DotScope, input: SuggestionInput): Suggestion {
    this.require(actor,scope,"suggest");
    input=suggestionInput(input);
    const id="dot-source-"+createHash("sha256").update(JSON.stringify([scopeKey(scope),input.source.kind,input.source.reference])).digest("hex");
    return this.repository.transaction(() => {
      const existing=this.repository.get<Suggestion>("suggestion",id,scope);
      if(existing){
        this.require(actor,scope,"suggest",existing.capabilities);
        const visible=this.suggestion(actor,scope,id);
        if(visible.prompt!==input.prompt || visible.title!==input.title || JSON.stringify([...visible.capabilities].sort())!==JSON.stringify([...new Set(input.capabilities)].sort()))throw new DotError("DOT_SOURCE_CONFLICT");
        return visible;
      }
      return this.createSuggestion(actor,scope,input,id);
    });
  }
  private createSuggestion(actor: Actor, scope: DotScope, input: SuggestionInput, stableId?: string): Suggestion {
    input=suggestionInput(input);
    this.require(actor,scope,"suggest",input.capabilities);
    if (input.source.kind === "memory" && !this.authorization.canReadMemory(actor,scope)) throw new DotError("DOT_MEMORY_DISABLED");
    this.authorization.requireSource(actor,scope,input.source);
    const now = this.now();
    if (input.expiresAt <= now) throw new DotError("DOT_EXPIRED");
    const value: Suggestion = { ...input, capabilities: [...new Set(input.capabilities)], scope, id: stableId ?? this.id(), revision: 0, state: "proposed", createdAt: now };
    this.repository.put("suggestion",value,null);
    return value;
  }
  dismiss(actor: Actor, scope: DotScope, id: string, revision: number): void {
    this.require(actor,scope,"cancel");
    this.repository.transaction(() => {
      const value = this.suggestion(actor,scope,id);
      if (value.revision !== revision || value.state !== "proposed") throw new DotConflict("Suggestion changed");
      this.repository.put("suggestion",{...value,state:"dismissed",revision:revision+1},revision);
    });
  }
  approve(actor: Actor, scope: DotScope, suggestionId: string, revision: number, input: { jobId: string; schedule: Schedule; missedPolicy: MissedPolicy; notificationPolicy: Followup["notificationPolicy"] }): Followup {
    if (!input || typeof input.jobId !== "string" || !input.jobId.length) throw new DotError("DOT_VALIDATION");
    validateSchedule(input.schedule);
    if (!["skip","latest","all"].includes(input.missedPolicy) || !["meaningful","failures","silent"].includes(input.notificationPolicy)) throw new DotError("DOT_VALIDATION");
    this.require(actor,scope,"approve");
    return this.repository.transaction(() => {
      const suggestion = this.suggestion(actor,scope,suggestionId);
      this.require(actor,scope,"approve",suggestion.capabilities);
      if (suggestion.revision !== revision || suggestion.state !== "proposed") throw new DotConflict("Suggestion changed");
      if ((input.schedule.kind === "once" && input.schedule.at <= this.now()) || suggestion.expiresAt <= this.now()) throw new DotError("DOT_EXPIRED");
      const job = this.jobs.readAuthorizedJob(actor,scope,input.jobId);
      if (scopeKey(job.scope) !== scopeKey(scope) || job.prompt !== suggestion.prompt || !job.enabled || job.cron || job.capabilities.some(c => !suggestion.capabilities.includes(c))) throw new DotError("DOT_JOB_BINDING_CHANGED");
      const followup: Followup = { id: suggestion.id, revision:0, suggestionId, scope, jobId:job.id, jobRevision:job.revision, scheduleRevision:job.scheduleRevision, schedule:input.schedule, missedPolicy:input.missedPolicy, notificationPolicy:input.notificationPolicy, capabilities:suggestion.capabilities, cursor:this.now(), state:"active" };
      this.repository.put("followup",followup,null);
      this.repository.put("suggestion",{...suggestion,state:"approved",revision:revision+1},revision);
      return followup;
    });
  }
  get(actor: Actor, scope: DotScope, kind: "suggestion"|"followup"|"operation"|"notification", id: string) {
    this.require(actor,scope,"read");
    if(kind === "suggestion") return this.suggestion(actor,scope,id);
    const value=this.repository.get(kind,id,scope);
    if(!value)throw new DotError("DOT_NOT_FOUND");
    return value;
  }
  page(actor: Actor, scope: DotScope, kind: "suggestion"|"followup"|"operation"|"notification", after = "", limit = 20) {
    this.require(actor,scope,"read");
    const page = this.repository.page(kind,scope,after,limit);
    if (kind === "suggestion") page.data = page.data.filter(value => {
      if (!("source" in value)) return false;
      if (value.source.kind === "memory" && !this.authorization.canReadMemory(actor,scope)) return false;
      try { this.authorization.requireSource(actor,scope,value.source); return true; }
      catch (error) {
        if (error instanceof DotError && ["DOT_FORBIDDEN","DOT_SOURCE_REVOKED","DOT_NOT_FOUND"].includes(error.code)) return false;
        throw error;
      }
    });
    return page;
  }
  setPaused(actor: Actor, scope: DotScope, id: string, revision: number, paused: boolean): Followup {
    this.require(actor,scope,"approve");
    return this.repository.transaction(() => {
      const f = this.repository.get<Followup>("followup",id,scope);
      if (!f) throw new DotError("DOT_NOT_FOUND");
      if (f.revision !== revision || f.state === "cancelled") throw new DotConflict("Follow-up changed");
      this.require(actor,scope,"approve",f.capabilities);
      const next: Followup = {...f,state:paused ? "paused" : "active",revision:f.revision+1};
      this.repository.put("followup",next,f.revision);
      return next;
    });
  }
  skipMissed(actor: Actor, scope: DotScope, id: string, revision: number): Followup {
    this.require(actor,scope,"approve");
    return this.repository.transaction(() => {
      const f=this.repository.get<Followup>("followup",id,scope);
      if(!f)throw new DotError("DOT_NOT_FOUND");
      if(f.revision !== revision || f.state === "cancelled")throw new DotConflict("Follow-up changed");
      this.require(actor,scope,"approve",f.capabilities);
      const now=this.now();
      if(!Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now || now < f.cursor)throw new DotError("DOT_CLOCK_REVERSED");
      if(now === f.cursor)return f;
      const operation:Operation={id:JSON.stringify([f.id,"explicit-skip",f.cursor,now]),revision:0,followupId:f.id,scope,scheduledFor:now,state:"skipped",runId:null,code:`USER_SKIPPED_RANGE:${f.cursor}`,updatedAt:now};
      this.repository.put("operation",operation,null);
      const next:Followup={...f,cursor:now,revision:f.revision+1};
      this.repository.put("followup",next,f.revision);
      return next;
    });
  }
  markRead(actor: Actor, scope: DotScope, id: string, revision: number): void {
    this.require(actor,scope,"read");
    const n = this.repository.get<Notification>("notification",id,scope);
    if (!n) throw new DotError("DOT_NOT_FOUND");
    if (n.read) return;
    if (n.revision !== revision) throw new DotConflict("Notification changed");
    this.repository.put("notification",{...n,read:true,revision:n.revision+1},revision);
  }
  reconcile(actor: Actor, scope: DotScope, followupId: string): { operations: Operation[]; skipped: number } {
    this.require(actor,scope,"dispatch");
    return this.repository.transaction(() => {
      const f = this.repository.get<Followup>("followup",followupId,scope);
      if (!f) throw new DotError("DOT_NOT_FOUND");
      if (f.state !== "active") return { operations:[], skipped:0 };
      this.require(actor,scope,"dispatch",f.capabilities);
      this.suggestion(actor,scope,f.suggestionId);
      const job = this.jobs.readAuthorizedJob(actor,scope,f.jobId);
      if (scopeKey(job.scope) !== scopeKey(scope) || job.revision !== f.jobRevision || job.scheduleRevision !== f.scheduleRevision || !job.enabled || job.cron) throw new DotError("DOT_JOB_BINDING_CHANGED");
      const now = this.now(), plan = planDue(f.schedule,f.cursor,now,f.missedPolicy);
      const operations: Operation[] = [];
      const due = f.missedPolicy === "all" ? plan.due.slice(0,1) : plan.due;
      let through = f.missedPolicy === "all" && plan.due.length > 1 ? due[0]! : plan.through;
      for (const scheduledFor of due) {
        const id = JSON.stringify([f.id,f.scheduleRevision,scheduledFor]);
        const prior = this.repository.get<Operation>("operation",id,scope);
        if (prior && !(prior.state === "blocked" && prior.code?.startsWith("WAIT_CAPACITY:"))) continue;
        // claim() must use the same API transaction/connection and never start a process here.
        const claim = this.jobs.claim(job,scheduledFor,"existing-grants-only");
        const operation: Operation = { id,revision:prior ? prior.revision+1 : 0,followupId:f.id,scope,scheduledFor,state:"runId" in claim ? "claimed" : "blocked",runId:"runId" in claim ? claim.runId : null,code:"blocked" in claim ? (claim.retryable ? "WAIT_CAPACITY:" : "")+claim.blocked : null,updatedAt:now };
        this.repository.put("operation",operation,prior?.revision ?? null);
        operations.push(operation);
        if ("blocked" in claim && claim.retryable) through = f.cursor;
      }
      if (plan.skipped) {
        const operation: Operation = { id:JSON.stringify([f.id,"skipped",f.cursor,now]),revision:0,followupId:f.id,scope,scheduledFor:now,state:"skipped",runId:null,code:`missed:${plan.skipped}`,updatedAt:now };
        if (!this.repository.get<Operation>("operation",operation.id,scope)) { this.repository.put("operation",operation,null); operations.push(operation); }
      }
      // Scheduler progress is not a user edit; keep open pause/cancel reviews valid.
      if(through !== f.cursor && (operations.length > 0 || Date.parse(through)-Date.parse(f.cursor) >= 60_000)) this.repository.advanceFollowupCursor(f,through);
      return { operations,skipped:plan.skipped };
    });
  }
  cancel(actor: Actor, scope: DotScope, id: string, revision: number): void {
    this.require(actor,scope,"cancel");
    this.repository.transaction(() => {
      const f = this.repository.get<Followup>("followup",id,scope);
      if (!f) throw new DotError("DOT_NOT_FOUND");
      if (f.state === "cancelled") return;
      if (f.revision !== revision) throw new DotConflict("Follow-up changed");
      this.repository.put("followup",{...f,state:"cancelled",revision:revision+1},revision);
      let cursor = "";
      do {
        const page = this.repository.page<Operation>("operation",scope,cursor,100);
        for (const op of page.data) if (op.followupId === id && !terminal.has(op.state)) {
          this.repository.put("operation",{...op,state:"cancel_requested",revision:op.revision+1,updatedAt:this.now()},op.revision);
        }
        cursor = page.nextCursor ?? "";
      } while(cursor);
    });
    // Persist intent before a runner signal. Recovery repeats only the idempotent cancellation request.
    this.recover(actor,scope);
  }
  recover(actor: Actor, scope: DotScope): void {
    this.require(actor,scope,"read");
    let cursor = "";
    do {
      const page = this.repository.page<Operation>("operation",scope,cursor,100);
      for (const op of page.data) {
        if (!op.runId || terminal.has(op.state)) continue;
        if (op.state === "cancel_requested") {
          this.require(actor,scope,"cancel");
          this.jobs.requestCancellation(scope,op.runId);
        }
        const state = this.jobs.inspect(scope,op.runId);
        const next = op.state === "cancel_requested" && (state === "running" || state === "unknown") ? "cancel_requested" : state;
        if (next !== op.state || (state === "unknown" && op.code !== "RUN_OUTCOME_UNKNOWN")) this.repository.put("operation",{...op,state:next,code:state === "unknown" ? "RUN_OUTCOME_UNKNOWN" : op.code,revision:op.revision+1,updatedAt:this.now()},op.revision);
      }
      cursor = page.nextCursor ?? "";
    } while(cursor);
  }
  notify(actor: Actor, scope: DotScope, operationId: string, meaningfulChange: boolean): Notification | null {
    this.require(actor,scope,"notify");
    return this.repository.transaction(() => {
      const op = this.repository.get<Operation>("operation",operationId,scope);
      if (!op) throw new DotError("DOT_NOT_FOUND");
      const f = this.repository.get<Followup>("followup",op.followupId,scope);
      if (!f) throw new DotError("DOT_NOT_FOUND");
      const existing = this.repository.get<Notification>("notification",op.id,scope);
      if (existing) return existing;
      const needsAttention = ["failed","unknown"].includes(op.state) || (op.state === "blocked" && !op.code?.startsWith("WAIT_CAPACITY:")) || op.code === "RUN_OUTCOME_UNKNOWN";
      if (f.notificationPolicy === "silent" || (!needsAttention && op.state !== "success")) return null;
      if (op.state === "success" && (f.notificationPolicy === "failures" || !meaningfulChange)) return null;
      const notification: Notification = { id:op.id,revision:0,operationId:op.id,scope,title:op.state === "success" ? "Your follow-up has an update" : "Your follow-up needs attention",read:false,createdAt:this.now() };
      this.repository.put("notification",notification,null);
      return notification;
    });
  }
}
