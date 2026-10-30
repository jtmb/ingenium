import { createHash, randomUUID } from "node:crypto";

export type Row = Record<string, any>;
export interface SqlDb {
  prepare(sql: string): { get(...values: any[]): any; all(...values: any[]): any[]; run(...values: any[]): { changes: number | bigint } };
}
export type Permission = "read" | "write" | "admin";
export interface Actor { id: string; sessionId: string; securityEpoch: number }
export interface VerifiedNative {
  actorId: string; nativeLibraryId: string; nativeServiceInstanceId: string;
  nativeProjectId: string | null; nativeProjectRevision: number | null;
}
export interface Ports {
  db(): SqlDb;
  transaction<T>(work: () => T): T;
  checkpoint(): void;
  actor(): Actor;
  allow(projectId: string, permission: Permission): boolean;
  systemAllowed(projectId: string): boolean;
  verifyEnrollment(requestId: string): VerifiedNative;
  verifyNativeOwner(grant: Row, recovery: boolean): void;
  isSafeSkillName(name: unknown): boolean;
  isValidSkillFileTree(value: unknown): boolean;
  locks(projectId: string): Row[];
  projectionPlan?(original: Row): Row;
  execute(command: Row, binding: Row, actor: Actor, operationId: string, projection: {plan:Row|null;events:Row[]}): Row | undefined;
  read(command: Row, binding: Row): unknown | Promise<unknown>;
}
export class HostedRefusal extends Error {
  code: string; status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
}
const fail = (code: string, status = 409): never => { throw new HostedRefusal(code,status); };
function object(value: unknown): value is Row {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype,null].includes(Object.getPrototypeOf(value));
}
function shape(value: unknown, required: string[], optional: string[] = []): asserts value is Row {
  if (!object(value) || required.some(key=>!Object.hasOwn(value,key))
      || Object.keys(value).some(key=>![...required,...optional].includes(key))) fail("INVALID_COMMAND",422);
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(value);
}
function revision(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value)>=0; }
function nullableId(value: unknown): boolean { return value===null || identifier(value); }
function snapshot(value: unknown, source=false): void {
  if (value===null) return;
  shape(value,source?["id","projectId","name","revision"]:["id","revision"]);
  if (!identifier(value.id) || !revision(value.revision) || source && (!identifier(value.projectId) || typeof value.name!=="string")) fail("INVALID_REVIEW",422);
}
/** Exact parsed JSON only; strings and byte-relevant content are never normalized. */
export function canonical(value: unknown): string {
  if (value===null || typeof value==="boolean") return JSON.stringify(value);
  if (typeof value==="number") { if (!Number.isSafeInteger(value)) fail("INVALID_JSON",422); return JSON.stringify(value); }
  if (typeof value==="string") {
    if (Buffer.from(value,"utf8").toString("utf8")!==value) fail("INVALID_UNICODE",422);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
  if (!object(value)) return fail("INVALID_JSON",422);
  const record: Row=value;
  return "{"+Object.keys(record).sort().map(key=>canonical(key)+":"+canonical(record[key])).join(",")+"}";
}
export const payloadHash = (value: unknown): string => createHash("sha256").update(canonical(value),"utf8").digest("hex");
/** Opaque server review token also catches a same-millisecond proposal-body replacement. */
export function proposalReviewHash(proposal: Row): string {
  const fields=["id","project_id","status","proposal_type","target_skill_id","target_name","source_project_id","source_name",
    "expected_revision","expected_source_revision","proposed_state","evidence_json","observation_ids","quality_score",
    "novelty_score","contradiction_flag","always_apply","candidate_group_key","updated_at"];
  return createHash("sha256").update(JSON.stringify(fields.map(key=>proposal[key]??null)),"utf8").digest("hex");
}
const bindingFields=["authorityId","connectionId","grantId","grantRevision","epoch","nativeLibraryId","nativeServiceInstanceId",
  "hostedServiceInstanceId","nativeProjectId","nativeProjectRevision","actorId","installationId","hostedProjectId","apiProject","visibility"];
const commandFields: Record<string,{required:string[];optional?:string[]}> = {
  create:{required:["op","reviewedAbsent","name","description","content"]},
  save:{required:["op","name","filePath","target","content","extra"]},
  archive:{required:["op","name","target"]},restore:{required:["op","name","target"]},
  enable:{required:["op","name","target"]},disable:{required:["op","name","target"]},
  submit:{required:["op","id","reviewed"],optional:["reviewer","reason"]},
  approve:{required:["op","id","reviewed","reviewer"],optional:["reason"]},
  reject:{required:["op","id","reviewed","reviewer"],optional:["reason"]},
  rollback:{required:["op","id","reviewed","reviewer"],optional:["reason"]},
};
export function validateOriginal(value: unknown, ports: Pick<Ports,"isSafeSkillName"|"isValidSkillFileTree">): Row {
  shape(value,["id","binding","command"]);
  if (!identifier(value.id)) fail("INVALID_OPERATION_ID",422);
  shape(value.binding,bindingFields); const b=value.binding;
  if (!["authorityId","connectionId","grantId","nativeLibraryId","nativeServiceInstanceId","hostedServiceInstanceId","actorId","installationId","hostedProjectId"].every(key=>identifier(b[key]))
    || typeof b.epoch!=="string" || !b.epoch || typeof b.apiProject!=="string" || !["project","system"].includes(b.visibility)
    || !revision(b.grantRevision) || b.grantRevision<1
    || !(b.nativeProjectId===null && b.nativeProjectRevision===null || identifier(b.nativeProjectId)&&revision(b.nativeProjectRevision))) fail("INVALID_BINDING",422);
  if (!object(value.command) || !Object.hasOwn(commandFields,value.command.op)) fail("UNSUPPORTED_COMMAND",422);
  const c=value.command,fields=commandFields[c.op]; if (!fields) return fail("UNSUPPORTED_COMMAND",422); shape(c,fields.required,fields.optional);
  if ("name" in c && !ports.isSafeSkillName(c.name)) fail("INVALID_NAME",422);
  if ("target" in c) { snapshot(c.target); if(c.target===null) fail("INVALID_REVIEW",422); }
  if (c.op==="create" && (c.reviewedAbsent!==true || typeof c.description!=="string" || typeof c.content!=="string")) fail("INVALID_COMMAND",422);
  if (c.op==="save") {
    shape(c.extra,["always_apply"],["tags","files"]);
    if(typeof c.content!=="string" || ![0,1].includes(c.extra.always_apply) || c.extra.tags!==undefined&&typeof c.extra.tags!=="string"
      || c.extra.files!==undefined&&(!ports.isValidSkillFileTree(c.extra.files)||typeof c.extra.files!=="string")
      || typeof c.filePath!=="string" || c.filePath.includes("\\") || c.filePath.includes("\0")
      || c.filePath.split("/").some((part:string)=>["",".",".."].includes(part))) fail("INVALID_COMMAND",422);
  }
  if ("reviewed" in c) {
    if(!identifier(c.id)) fail("INVALID_REVIEW",422);
    shape(c.reviewed,["status","updatedAt","targetSkillId","sourceProjectId","sourceName","expectedRevision","expectedSourceRevision","currentTarget","currentSource","proposalHash"]);
    const r=c.reviewed;
    if(typeof r.status!=="string" || typeof r.updatedAt!=="string" || !r.updatedAt || typeof r.proposalHash!=="string" || !/^[0-9a-f]{64}$/.test(r.proposalHash) || !nullableId(r.targetSkillId)
      || !nullableId(r.sourceProjectId) || !(r.sourceName===null||ports.isSafeSkillName(r.sourceName))
      || !(r.expectedRevision===null||revision(r.expectedRevision)) || !(r.expectedSourceRevision===null||revision(r.expectedSourceRevision))) fail("INVALID_REVIEW",422);
    snapshot(r.currentTarget); snapshot(r.currentSource,true);
    if(c.reviewer!==undefined && (typeof c.reviewer!=="string" || !c.reviewer.trim() || c.reviewer.length>256)
      || c.reason!==undefined && (typeof c.reason!=="string" || c.reason.length>4000)) fail("INVALID_COMMAND",422);
  }
  if(Buffer.byteLength(canonical(value),"utf8")>2_000_000) fail("COMMAND_TOO_LARGE",413);
  return value;
}
function permission(op: string): Permission { return ["restore","approve","rollback"].includes(op)?"admin":"write"; }
function valueRef(result: Row,projectId: string,proposal: boolean): Row {
  if(!result || !identifier(result.id)) throw new Error("CORE_EFFECT_RESULT_MISSING");
  return proposal?{kind:"proposal",id:result.id,projectId,status:result.status,updatedAt:result.updated_at}
    :{kind:"skill",id:result.id,projectId,revision:result.revision};
}
/** Canonical Core-only owner; injected ports are existing owners, not an alternate store or authority. */
export function createHostedGovernance(ports: Ports) {
  const db=()=>ports.db();
  const identity=()=>{
    const actor=ports.actor();
    const installation=db().prepare("SELECT instance_id FROM veyra_installation_identity WHERE singleton=1").get();
    if(!installation || !identifier(actor.id)) fail("HOST_IDENTITY_UNAVAILABLE",503);
    return {actorId:actor.id,installationId:installation.instance_id,hostedServiceInstanceId:installation.instance_id,
      authorityId:"veyra-hosted-governance:"+installation.instance_id};
  };
  function grant(id: string): Row {
    const i=identity();
    const g=db().prepare("SELECT * FROM native_hosted_governance_grants WHERE id=? AND owner_user_id=? AND installation_id=?").get(id,i.actorId,i.installationId);
    if(!g) fail("NOT_FOUND",404);
    return g;
  }
  function capabilities(g: Row): string[] {
    if(g.revoked_at || !ports.allow(g.hosted_project_id,"read") || g.visibility==="system"&&!ports.systemAllowed(g.hosted_project_id)) return [];
    return ["catalog","skill","archived","proposal-counts","proposal-page","proposal","synthesis-status","pipeline",
      ...Object.keys(commandFields).filter(op=>ports.allow(g.hosted_project_id,permission(op)))];
  }
  function currentBinding(g: Row,recovery=false): {binding:Row;capabilities:string[];capabilityRevision:string} {
    const actor=ports.actor(),i=identity();
    if(g.owner_user_id!==actor.id || g.revoked_at) fail("NOT_FOUND",404);
    if(!ports.allow(g.hosted_project_id,"read") || g.visibility==="system"&&!ports.systemAllowed(g.hosted_project_id)) fail("NOT_FOUND",404);
    ports.verifyNativeOwner(g,recovery);
    const p=db().prepare("SELECT id,name,archived_at FROM projects WHERE id=?").get(g.hosted_project_id);
    if(!p || p.archived_at) fail("NOT_FOUND",404);
    const caps=capabilities(g);
    const capabilityRevision=payloadHash([actor.securityEpoch,g.revision,caps]);
    const binding={...i,connectionId:g.connection_id,grantId:g.id,grantRevision:g.revision,
      epoch:payloadHash([g.epoch,capabilityRevision]),nativeLibraryId:g.native_library_id,nativeServiceInstanceId:g.native_service_instance_id,
      nativeProjectId:g.native_project_id,nativeProjectRevision:g.native_project_revision,hostedProjectId:g.hosted_project_id,
      apiProject:p.name,visibility:g.visibility};
    return {binding,capabilities:caps,capabilityRevision};
  }
  function receipt(row: Row): Row {
    return {operationId:row.operation_id,payloadHash:row.payload_hash,
      outcome:row.state==="executing"?"unknown":row.state,
      ...(row.value_ref_json?{valueRef:JSON.parse(row.value_ref_json)}:{}),
      ...(row.state==="refused"?{error:{code:row.error_code,status:row.error_status,message:"Hosted governance operation refused"}}:{}),
      ...(row.first_failure_code?{firstFailureCode:row.first_failure_code}:{})};
  }
  function authorizedReceipt(g: Row,row: Row|undefined): Row {
    currentBinding(g,true);
    if(!row) return {outcome:"unknown",operationId:null,payloadHash:null};
    if(row.actor_id!==g.owner_user_id || row.project_id!==g.hosted_project_id || row.grant_id!==g.id) fail("NOT_FOUND",404);
    if(row.source_project_id && !ports.allow(row.source_project_id,"read")) fail("NOT_FOUND",404);
    return receipt(row);
  }
  function checkLocks(projectId: string,token: unknown): void {
    for(const lock of ports.locks(projectId)) if(typeof token!=="string" || token!==lock.owner_token) fail("LOCKED",423);
  }
  function review(command: Row,projectId: string,tokens: Row): void {
    const get=(name:string)=>db().prepare("SELECT * FROM skills WHERE project_id=? AND name=?").get(projectId,name);
    if(command.op==="create") { if(get(command.name)) fail("TARGET_EXISTS"); return; }
    if(command.target) {
      const row=get(command.name);
      if(!row || row.id!==command.target.id || row.revision!==command.target.revision) fail("SKILL_CAS_CONFLICT");
      if(command.op==="restore" ? row.archived_at===null : row.archived_at!==null) fail("INVALID_SKILL_STATE");
      return;
    }
    const p=db().prepare("SELECT * FROM skill_proposals WHERE id=? AND project_id=?").get(command.id,projectId);
    if(!p) fail("PROPOSAL_NOT_FOUND",404);
    const r=command.reviewed;
    if(proposalReviewHash(p)!==r.proposalHash) fail("PROPOSAL_CAS_CONFLICT");
    const meta={status:p.status,updatedAt:p.updated_at,targetSkillId:p.target_skill_id??null,
      sourceProjectId:p.source_project_id??null,sourceName:p.source_name??null,
      expectedRevision:p.expected_revision??null,expectedSourceRevision:p.expected_source_revision??null};
    for(const key of Object.keys(meta)) if(meta[key as keyof typeof meta]!==r[key]) fail("PROPOSAL_CAS_CONFLICT");
    const expectedStatus=command.op==="submit"?"draft":command.op==="rollback"?"applied":"pending";
    if(p.status!==expectedStatus) fail("INVALID_PROPOSAL_STATE");
    const target=p.target_skill_id
      ?db().prepare("SELECT * FROM skills WHERE id=? AND project_id=?").get(p.target_skill_id,projectId)
      :get(p.target_name);
    const targetSnapshot=target?{id:target.id,revision:target.revision}:null;
    if(canonical(targetSnapshot)!==canonical(r.currentTarget)) fail("TARGET_CAS_CONFLICT");
    if(p.target_skill_id && target?.id!==p.target_skill_id) fail("TARGET_CAS_CONFLICT");
    if(target && target.name!==p.target_name) fail("TARGET_NAME_CHANGED");
    if(p.proposal_type==="merge") {
      if(!p.source_project_id || !p.source_name || !ports.allow(p.source_project_id,"read")) fail("SOURCE_FORBIDDEN",404);
      const source=db().prepare("SELECT * FROM skills WHERE project_id=? AND name=?").get(p.source_project_id,p.source_name);
      const sourceSnapshot=source?{id:source.id,projectId:source.project_id,name:source.name,revision:source.revision}:null;
      if(!source || canonical(sourceSnapshot)!==canonical(r.currentSource)) fail("SOURCE_CAS_CONFLICT");
      if(command.op==="approve" && source.archived_at!==null) fail("STALE_PROPOSAL");
      if(["approve","rollback"].includes(command.op)) {
        if(!ports.allow(p.source_project_id,"admin")) fail("SOURCE_FORBIDDEN",403);
        checkLocks(p.source_project_id,p.source_project_id===projectId?tokens.target:tokens.source);
      }
    } else if(r.currentSource!==null) fail("SOURCE_CAS_CONFLICT");
    if(command.op==="approve" && (target?.archived_at || p.proposal_type==="create"&&target
      || p.expected_revision!==null&&p.expected_revision!==undefined&&target?.revision!==p.expected_revision
      || p.proposal_type==="merge"&&p.expected_source_revision!==null&&p.expected_source_revision!==undefined
        &&p.expected_source_revision!==r.currentSource?.revision)) fail("STALE_PROPOSAL");
  }
  function inspect(operationId: string,grantId: string): Row {
    if(!identifier(operationId)||!identifier(grantId)) fail("INVALID_OPERATION_ID",422);
    const g=grant(grantId);
    const row=db().prepare("SELECT * FROM native_hosted_governance_effects WHERE operation_id=?").get(operationId);
    const result=authorizedReceipt(g,row);
    return row?result:{...result,operationId};
  }
  return {
    identity,
    enroll(input: unknown): Row {
      shape(input,["enrollmentRequestId","hostedProjectId","visibility"]);
      if(!identifier(input.enrollmentRequestId)||!identifier(input.hostedProjectId)||!["project","system"].includes(input.visibility)) fail("INVALID_ENROLLMENT",422);
      const result=ports.transaction(()=>{
        const i=identity(),native=ports.verifyEnrollment(input.enrollmentRequestId);
        if(native.actorId!==i.actorId || !identifier(native.nativeLibraryId)||!identifier(native.nativeServiceInstanceId)
          || !(native.nativeProjectId===null&&native.nativeProjectRevision===null || identifier(native.nativeProjectId)&&revision(native.nativeProjectRevision))) fail("NATIVE_ATTESTATION_REQUIRED",503);
        if(!ports.allow(input.hostedProjectId,"read") || input.visibility==="system"&&!ports.systemAllowed(input.hostedProjectId)) fail("NOT_FOUND",404);
        const hash=payloadHash({input,native,actorId:i.actorId,installationId:i.installationId});
        const old=db().prepare("SELECT * FROM native_hosted_governance_grants WHERE enrollment_request_id=?").get(input.enrollmentRequestId);
        if(old) {
          if(old.owner_user_id!==i.actorId) fail("NOT_FOUND",404);
          if(old.enrollment_hash!==hash) fail("ENROLLMENT_REUSE_CONFLICT");
          return currentBinding(old);
        }
        const id=randomUUID(),now=new Date().toISOString();
        db().prepare("INSERT INTO native_hosted_governance_grants(id,enrollment_request_id,enrollment_hash,connection_id,owner_user_id,installation_id,native_library_id,native_service_instance_id,native_project_id,native_project_revision,hosted_project_id,visibility,revision,epoch,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)")
          .run(id,input.enrollmentRequestId,hash,randomUUID(),i.actorId,i.installationId,native.nativeLibraryId,native.nativeServiceInstanceId,native.nativeProjectId,native.nativeProjectRevision,input.hostedProjectId,input.visibility,randomUUID(),now);
        return currentBinding(grant(id));
      });
      ports.checkpoint();return result;
    },
    binding(grantId: string): Row { return currentBinding(grant(grantId)); },
    async read(grantId: string,command: Row): Promise<Row> {
      if(!object(command) || typeof command.op!=="string") fail("INVALID_COMMAND",422);
      const g=grant(grantId),before=currentBinding(g);
      if(!before.capabilities.includes(command.op) || Object.hasOwn(commandFields,command.op)) fail("UNSUPPORTED_READ",403);
      const value=await ports.read(command,before.binding);
      const after=currentBinding(grant(grantId));
      if(canonical(before.binding)!==canonical(after.binding)) fail("STALE_BINDING");
      return {binding:after.binding,value};
    },
    effect(value: unknown,tokens: Row={}): Row {
      const original=validateOriginal(value,ports),hash=payloadHash(original);
      const admission=ports.transaction(()=>{
        const g=grant(original.binding.grantId),actor=ports.actor();
        if(original.binding.actorId!==actor.id || original.binding.hostedProjectId!==g.hosted_project_id) fail("NOT_FOUND",404);
        const old=db().prepare("SELECT * FROM native_hosted_governance_effects WHERE operation_id=?").get(original.id);
        if(old) {
          if(old.actor_id!==actor.id || old.project_id!==g.hosted_project_id || old.grant_id!==g.id) fail("NOT_FOUND",404);
          if(old.payload_hash!==hash) fail("OPERATION_REUSE_CONFLICT");
          return {fresh:false,receipt:authorizedReceipt(g,old)};
        }
        const now=new Date().toISOString();
        const projectionPlan=ports.projectionPlan?.(original)??null;
        const proposalSource=original.command.reviewed
          ?db().prepare("SELECT source_project_id FROM skill_proposals WHERE id=? AND project_id=?").get(original.command.id,g.hosted_project_id)?.source_project_id??null
          :null;
        db().prepare("INSERT INTO native_hosted_governance_effects(operation_id,grant_id,actor_id,project_id,source_project_id,payload_hash,binding_hash,command_kind,projection_plan_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'executing',?,?)")
          .run(original.id,g.id,actor.id,g.hosted_project_id,proposalSource,hash,payloadHash(original.binding),original.command.op,projectionPlan?JSON.stringify(projectionPlan):null,now,now);
        return {fresh:true};
      });
      ports.checkpoint();
      if(!admission.fresh) return admission.receipt!;
      const projectionEvents: Row[]=[];
      try {
        const terminal=ports.transaction(()=>{
          const admitted=db().prepare("SELECT * FROM native_hosted_governance_effects WHERE operation_id=?").get(original.id);
          if(!admitted || admitted.payload_hash!==hash) throw new Error("CORE_ADMISSION_CHANGED");
          if(admitted.state!=="executing") return receipt(admitted);
          const g=db().prepare("SELECT * FROM native_hosted_governance_grants WHERE id=?").get(original.binding.grantId);
          let actor: Actor;
          try {
            if(!g) fail("NOT_FOUND",404);
            actor=ports.actor();
            const current=currentBinding(g);
            if(canonical(original.binding)!==canonical(current.binding)) fail("STALE_BINDING");
            if(!ports.allow(g.hosted_project_id,permission(original.command.op))) fail("FORBIDDEN",403);
            checkLocks(g.hosted_project_id,tokens.target);
            review(original.command,g.hosted_project_id,tokens);
          } catch(error) {
            if(!(error instanceof HostedRefusal)) throw error;
            db().prepare("UPDATE native_hosted_governance_effects SET state='refused',error_code=?,error_status=?,updated_at=? WHERE operation_id=? AND state='executing'")
              .run(error.code,error.status,new Date().toISOString(),original.id);
            return receipt(db().prepare("SELECT * FROM native_hosted_governance_effects WHERE operation_id=?").get(original.id));
          }
          const result=ports.execute(original.command,original.binding,actor!,original.id,{plan:admitted.projection_plan_json?JSON.parse(admitted.projection_plan_json):null,events:projectionEvents});
          if(!result) throw new Error("CORE_EFFECT_RESULT_MISSING");
          const expectedStatus: Row={submit:"pending",approve:"applied",reject:"rejected",rollback:"rolled_back"};
          if(original.command.reviewed && result.status!==expectedStatus[original.command.op]) throw new Error("CORE_EFFECT_STATUS_UNEXPECTED");
          const ref=valueRef(result,g.hosted_project_id,!!original.command.reviewed);
          db().prepare("UPDATE native_hosted_governance_effects SET state='succeeded',value_ref_json=?,updated_at=? WHERE operation_id=? AND state='executing'")
            .run(JSON.stringify(ref),new Date().toISOString(),original.id);
          return receipt(db().prepare("SELECT * FROM native_hosted_governance_effects WHERE operation_id=?").get(original.id));
        });
        ports.checkpoint();return terminal;
      } catch {
        try {
          ports.transaction(()=>db().prepare("UPDATE native_hosted_governance_effects SET first_failure_code=COALESCE(first_failure_code,'CORE_EFFECT_INTERRUPTED'),projection_witness_json=COALESCE(projection_witness_json,?) WHERE operation_id=?").run(JSON.stringify(projectionEvents),original.id));
          ports.checkpoint();
        } catch { /* Durable admission blocks replay even when failure annotation is unavailable. */ }
        return {operationId:original.id,payloadHash:hash,outcome:"unknown",firstFailureCode:"CORE_EFFECT_INTERRUPTED"};
      }
    },
    inspect,
    pending(grantId: string,after="",limit=25): Row {
      if(!identifier(grantId) || after!==""&&!identifier(after) || !Number.isSafeInteger(limit)||limit<1||limit>100) fail("INVALID_CURSOR",422);
      const g=grant(grantId);currentBinding(g,true);
      const rows=db().prepare("SELECT * FROM native_hosted_governance_effects WHERE grant_id=? AND actor_id=? AND state='executing' AND operation_id>? ORDER BY operation_id LIMIT ?").all(grantId,g.owner_user_id,after,limit+1);
      const data=rows.slice(0,limit).map(row=>authorizedReceipt(g,row));
      return {data,pagination:{hasMore:rows.length>limit,nextCursor:rows.length>limit?rows[limit-1].operation_id:null}};
    },
  };
}
