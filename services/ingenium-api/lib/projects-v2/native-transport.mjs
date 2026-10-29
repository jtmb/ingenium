import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {requireValue,scopeKey,validateBinding,terminalDimensions,terminalInput,text} from "../../../../packages/veyra-projects/domain.mjs";
import {immutableInput} from "./immutable-input.mjs";

const base="/v1";
const domains={
  branch:{submit:"/git-review/branches/operations",receipt:"/git-review/branches/operations",capability:"git:branch"},
  change:{submit:"/git-review/operations",receipt:"/git-review/operations",capability:"git:change"},
  worktree:{submit:"/git-review/worktrees/operations",receipt:"/git-review/worktrees/operations",capability:"worktrees:create"},
  archive:{submit:"/git-review/worktree-archives/operations",receipt:"/git-review/worktree-archives/operations",capability:"worktrees:archive"},
  finding:{submit:"/git-review/findings",receipt:"/git-review/findings",capability:"git:findings:write"},
  triage:{submit:"/git-review/finding-triage",receipt:"/git-review/finding-triage",capability:"git:findings:triage"},
  assessment:{submit:"/git-review/finding-assessments",receipt:"/git-review/finding-assessments",capability:"git:findings:assessment"},
};
function nativeId(value) {
  requireValue(typeof value==="string" && value.length===36 && value!=="00000000-0000-0000-0000-000000000000");
  requireValue(Array.from(value).every((c,i)=>[8,13,18,23].includes(i) ? c==="-" : "0123456789abcdef".includes(c)));
  return value;
}
export function terminalRequestFingerprint(body,terminalId=null) {
  function canonical(value) {
    if(Array.isArray(value)) return value.map(canonical);
    if(value && typeof value==="object") return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
    return value;
  }
  return createHash("sha256").update(JSON.stringify(canonical({terminal_id:terminalId,body:immutableInput(body)}))).digest("hex");
}
function terminalOwner(projectId,binding) {
  requireValue(projectId!==null,"NATIVE_PROJECTLESS_UNSUPPORTED",501);
  validateBinding(binding);nativeId(projectId);nativeId(binding.ownerInstanceId);
  requireValue(binding.kind==="windows" || binding.kind==="wsl","NATIVE_ENVIRONMENT_UNSUPPORTED",501);
  return {project_id:projectId,project_revision:binding.ownerRevision,service_instance_id:binding.ownerInstanceId,
    environment:binding.kind==="windows" ? {kind:"windows"} : {kind:"wsl",distro:binding.distro,user:binding.user}};
}
function query(owner) {
  return {project_id:owner.project_id,expected_project_revision:owner.project_revision,
    service_instance_id:owner.service_instance_id};
}
function state(value) {
  const states={pending:"pending",succeeded:"succeeded",uncertain:"unknown",not_admitted:"failed"};
  requireValue(Object.hasOwn(states,value),"INVALID_NATIVE_RECEIPT",502);
  return states[value];
}
function reviewOwner(original,domain) {
  if(domain==="finding") return original.source?.owner;
  if(domain==="triage") return original.finding?.original?.source?.owner;
  if(domain==="assessment") return original.finding?.original?.source?.owner;
  return original.owner;
}
export class NativeWorkspaceTransport {
  constructor({transport,authorize}) {Object.assign(this,{transport,authorize});}
  async #call(scope,{instanceId,projectId,capability,method,path,query:params={},body,binding=null,maxResponseBytes=2*1024*1024}) {
    scope=immutableInput(scope);scopeKey(scope);params=immutableInput(params);
    binding=immutableInput(binding);
    if(body!==undefined) body=immutableInput(body);
    nativeId(instanceId);
    requireValue(await this.authorize(scope,capability,{instanceId,projectId,binding,body})===true,"FORBIDDEN",403);
    // The coordinator supplies the authenticated, instance-pinned native connection, never a URL from Work.
    const reply=await this.transport(immutableInput({scope,expectedInstanceId:instanceId,method,path:base+path,
      query:params,...(body===undefined ? {} : {body}),maxResponseBytes,redirect:"error"}));
    requireValue(reply?.instanceId===instanceId,"NATIVE_INSTANCE_CHANGED",409);
    requireValue(Number.isInteger(reply.status),"INVALID_NATIVE_RESPONSE",502);
    if(reply.status<200 || reply.status>=300) {
      const status=[400,401,403,404,409,413,422,501,503].includes(reply.status) ? reply.status : 502;
      requireValue(false,"NATIVE_REQUEST_REFUSED",status);
    }
    requireValue(reply.data && typeof reply.data==="object" && !Array.isArray(reply.data),"INVALID_NATIVE_RESPONSE",502);
    try {return immutableInput(reply.data);} catch {requireValue(false,"INVALID_NATIVE_RESPONSE",502);}
  }
  projectOwner() {
    return {
      getProject:async input=>{
        const {scope,projectId,expectedInstanceId}=immutableInput(input);nativeId(projectId);
        return {instanceId:expectedInstanceId,project:await this.#call(scope,{instanceId:expectedInstanceId,
          projectId,capability:"projects:read",method:"GET",path:"/projects/"+projectId})};
      },
      listProjects:async input=>{
        const {scope,after,limit,archived,expectedInstanceId}=immutableInput(input);
        requireValue(typeof after==="string" && Number.isInteger(limit) && limit>0 && limit<=100 && typeof archived==="boolean");
        const page=await this.#call(scope,{instanceId:expectedInstanceId,projectId:null,capability:"projects:list",
          method:"GET",path:"/projects",query:{...(after===""?{}:{after}),limit,archived}});
        requireValue(Array.isArray(page.projects) && (page.next_cursor===null || typeof page.next_cursor==="string"),
          "INVALID_NATIVE_RESPONSE",502);
        return {instanceId:expectedInstanceId,...page};
      },
      createProject:async input=>{
        const {scope,expectedInstanceId,request}=immutableInput(input);nativeId(request.project_id);
        return {instanceId:expectedInstanceId,project:await this.#call(scope,{instanceId:expectedInstanceId,
          projectId:request.project_id,capability:"projects:create",method:"POST",path:"/projects",body:request})};
      },
      updateProject:async input=>{
        const {scope,projectId,expectedInstanceId,request}=immutableInput(input);nativeId(projectId);
        return {instanceId:expectedInstanceId,project:await this.#call(scope,{instanceId:expectedInstanceId,
          projectId,capability:"projects:write",method:"POST",path:"/projects/"+projectId,body:request})};
      },
    };
  }
  terminalRequest(input) {
    const {scope,projectId,binding,action,args={},operationId}=immutableInput(input);
    const owner=terminalOwner(projectId,binding);nativeId(operationId);
    const type={"terminal.open":"create","terminal.input":"input","terminal.resize":"resize","terminal.close":"close"}[action];
    requireValue(type,"UNSUPPORTED_NATIVE_ACTION",501);
    let path="/interactive-terminals/";
    let body={owner,request_id:operationId};
    if(type==="create") {
      terminalDimensions(args.columns??80,args.rows??24);
      body={...body,columns:args.columns??80,rows:args.rows??24,shell:binding.shellId,save_default:false,
        expected_default_revision:null};
    } else {
      nativeId(args.terminalId);path="/interactive-terminals/"+args.terminalId+"/"+type;
      if(type==="input") {requireValue(terminalInput(args.data).length>0);body={...body,text:args.data};}
      if(type==="resize") body={...body,...terminalDimensions(args.columns,args.rows)};
    }
    return {scope,projectId,binding,operationId,args,owner,type,path,body};
  }
  async terminalDispatch(input) {
    const {scope,projectId,binding,operationId,args,owner,type,path,body}=this.terminalRequest(input);
    const receipt=await this.#call(scope,{instanceId:binding.ownerInstanceId,projectId,binding,
      capability:type==="create" ? "terminal:open" : "terminal:"+type,method:"POST",path,body});
    return this.terminalResult(receipt,owner,operationId,type,args.terminalId);
  }
  terminalResult(receipt,owner,operationId,type,terminalId) {
    requireValue(receipt.request_id===operationId && receipt.kind===type &&
      isDeepStrictEqual(receipt.owner,owner) && (type==="create" || receipt.terminal_id===terminalId),
      "INVALID_NATIVE_RECEIPT",502);
    return {state:state(receipt.state),result:{nativeReceipt:receipt}};
  }
  async terminalReceipt(input) {
    const {scope,projectId,binding,operationId,args,owner,type,body}=this.terminalRequest(input);
    const receipt=await this.#call(scope,{instanceId:binding.ownerInstanceId,projectId,binding,capability:"terminal:read",
      method:"GET",path:"/interactive-terminals/operations/"+operationId,query:query(owner)});
    const observed=this.terminalResult(receipt,owner,operationId,type,args.terminalId);
    // The current native public receipt omits its exact Mutation original. Do not settle a facade
    // original from a colliding request ID until the native owner exposes its retained request fingerprint.
    if(typeof receipt.original_sha256!=="string") return {state:"unknown",result:{nativeReceipt:receipt,
      code:"NATIVE_TERMINAL_ORIGINAL_UNVERIFIED"}};
    requireValue(receipt.original_sha256===terminalRequestFingerprint(body,args.terminalId??null),
      "OPERATION_CONFLICT",409);
    return observed;
  }
  async terminalRead(input) {
    const {scope,projectId,binding,terminalId=null,after=0}=immutableInput(input);
    const owner=terminalOwner(projectId,binding);
    requireValue(Number.isSafeInteger(after) && after>=0);
    if(terminalId!==null) nativeId(terminalId);
    const result=await this.#call(scope,{instanceId:binding.ownerInstanceId,projectId,binding,capability:"terminal:read",
      method:"GET",path:"/interactive-terminals/"+(terminalId??""),query:{...query(owner),...(terminalId===null?{}:{after})}});
    requireValue(isDeepStrictEqual(result.owner,owner),"INVALID_NATIVE_OWNER",502);
    if(terminalId!==null) requireValue(result.id===terminalId,"INVALID_NATIVE_OWNER",502);
    // Native sequence/output_base64 retain the native byte-cursor semantics. Never turn them into synthetic chunk indices.
    return result;
  }
  async reviewRead(input) {
    const {scope,projectId,binding,base:reviewBase="",path=""}=immutableInput(input);
    const owner=terminalOwner(projectId,binding);requireValue(binding.kind==="windows","NATIVE_GIT_ENVIRONMENT_UNSUPPORTED",501);
    requireValue(typeof reviewBase==="string" && reviewBase.length<=512 && typeof path==="string" && path.length<=4096);
    const result=await this.#call(scope,{instanceId:binding.ownerInstanceId,projectId,binding,capability:"git:read",
      method:"GET",path:"/git-review/",query:{...query(owner),base:reviewBase,path},maxResponseBytes:12*1024*1024});
    requireValue(result.owner?.project_id===owner.project_id &&
      result.owner?.project_revision===owner.project_revision &&
      result.owner?.service_instance_id===owner.service_instance_id &&
      isDeepStrictEqual(result.owner?.environment,owner.environment),"INVALID_NATIVE_OWNER",502);
    return result;
  }
  async previewReviewed(input) {
    const {scope,projectId,binding,domain,selection}=immutableInput(input);
    const owner=terminalOwner(projectId,binding);
    requireValue(binding.kind==="windows","NATIVE_GIT_ENVIRONMENT_UNSUPPORTED",501);
    requireValue(domain==="worktree" || domain==="archive");
    requireValue(selection && typeof selection==="object" && !Array.isArray(selection));
    const allowed=domain==="worktree" ? ["task_session_id","base","branch","destination"] :
      ["worktree_id","task_session_id","operation"];
    requireValue(Object.keys(selection).every(key=>allowed.includes(key)));
    if(selection.task_session_id!==undefined && selection.task_session_id!==null) nativeId(selection.task_session_id);
    if(domain==="worktree") requireValue(text(selection.base) && text(selection.branch) && text(selection.destination));
    else {nativeId(selection.worktree_id);requireValue(["archive","restore"].includes(selection.operation));}
    const original=await this.#call(scope,{instanceId:binding.ownerInstanceId,projectId,binding,
      capability:domain==="worktree" ? "worktrees:preview" : "worktrees:"+selection.operation,
      method:"POST",path:domain==="worktree" ? "/git-review/worktrees/preview" : "/git-review/worktree-archives/preview",
      body:{...query(owner),task_session_id:null,...selection}});
    requireValue(original.original?.owner?.project_id===owner.project_id &&
      original.original?.owner?.project_revision===owner.project_revision &&
      original.original?.owner?.service_instance_id===owner.service_instance_id &&
      isDeepStrictEqual(original.original?.owner?.environment,owner.environment),"INVALID_NATIVE_OWNER",502);
    nativeId(original.original.request_id);
    return original;
  }
  async submitReviewed(input) {
    const {scope,projectId,binding,domain,original}=immutableInput(input);
    const bound=terminalOwner(projectId,binding);
    requireValue(binding.kind==="windows","NATIVE_GIT_ENVIRONMENT_UNSUPPORTED",501);
    requireValue(typeof domain==="string" && Object.hasOwn(domains,domain));
    const owner=reviewOwner(original,domain);
    requireValue(owner && owner.project_id===bound.project_id && owner.project_revision===bound.project_revision &&
      owner.service_instance_id===bound.service_instance_id && isDeepStrictEqual(owner.environment,bound.environment),
      "NATIVE_OWNER_MISMATCH",409);
    nativeId(original.request_id??original.id);
    if(domain==="change") requireValue(original.confirmed===true,"EXPLICIT_GIT_CONFIRMATION_REQUIRED",403);
    requireValue(Buffer.byteLength(JSON.stringify(original),"utf8")<=(domain==="change" ? 384*1024 : 32*1024));
    if(domain==="change") requireValue(["stage_file","unstage_file","stage_hunk","unstage_hunk",
      "revert_file","revert_hunk","commit","push","create_pull_request"].includes(original.operation?.kind));
    const selected=domains[domain];
    const capability=domain==="change" ? "git:change:"+original.operation?.kind :
      domain==="archive" && original.operation==="restore" ? "worktrees:restore" : selected.capability;
    const receipt=await this.#call(scope,{instanceId:binding.ownerInstanceId,projectId,binding,capability,
      method:"POST",path:selected.submit,body:original});
    requireValue(isDeepStrictEqual(receipt.original,original),"INVALID_NATIVE_RECEIPT",502);
    return {state:domain==="finding" || domain==="triage" || domain==="assessment" ? "succeeded" : state(receipt.state),
      result:{nativeReceipt:receipt}};
  }
  async reviewedReceipt(input) {
    const {scope,projectId,binding,domain,original}=immutableInput(input);
    const owner=terminalOwner(projectId,binding);requireValue(typeof domain==="string" && Object.hasOwn(domains,domain));
    const originalOwner=reviewOwner(original,domain);
    requireValue(originalOwner?.project_id===owner.project_id && originalOwner?.project_revision===owner.project_revision &&
      originalOwner?.service_instance_id===owner.service_instance_id &&
      isDeepStrictEqual(originalOwner?.environment,owner.environment),"NATIVE_OWNER_MISMATCH",409);
    const id=nativeId(original.request_id??original.id);
    const receipt=await this.#call(scope,{instanceId:binding.ownerInstanceId,projectId,binding,capability:"git:read",
      method:"GET",path:domains[domain].receipt+"/"+id,query:query(owner)});
    requireValue(isDeepStrictEqual(receipt.original,original),"INVALID_NATIVE_RECEIPT",502);
    return {state:domain==="finding" || domain==="triage" || domain==="assessment" ? "succeeded" : state(receipt.state),
      result:{nativeReceipt:receipt}};
  }
}
