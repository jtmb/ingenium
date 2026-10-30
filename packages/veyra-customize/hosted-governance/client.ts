import type {Binding, BoundGovernanceTransport, CatalogRow, Command, OperationReceipt, ReadCommand, Skill, WriteCommand, WriteOriginal} from "./contracts";
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim() && !/[\u0000-\u001f]/u.test(v);
const int = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const nullable = (v: unknown) => v === null || typeof v === "string";
const writes = new Set(["create","save","archive","restore","enable","disable","submit","approve","reject","rollback","synthesis-run"]);
const bindingFields=["authorityId","connectionId","grantId","grantRevision","epoch","nativeLibraryId","nativeServiceInstanceId","hostedServiceInstanceId","nativeProjectId","nativeProjectRevision","actorId","installationId","hostedProjectId","apiProject","visibility"];
export function bindingKey(b: Binding): string {
  if (!b || Object.keys(b).length!==bindingFields.length || Object.keys(b).some(key=>!bindingFields.includes(key)) || ![b.authorityId,b.connectionId,b.grantId,b.epoch,b.nativeLibraryId,b.nativeServiceInstanceId,b.hostedServiceInstanceId,b.actorId,b.installationId,b.hostedProjectId,b.apiProject].every(text)
    || !int(b.grantRevision) || b.grantRevision < 1 || !["project","system"].includes(b.visibility)
    || !(b.nativeProjectId === null && b.nativeProjectRevision === null || text(b.nativeProjectId) && int(b.nativeProjectRevision))) throw new Error("An explicit original hosted authority is required.");
  return JSON.stringify([b.authorityId,b.connectionId,b.grantId,b.grantRevision,b.epoch,b.nativeLibraryId,b.nativeServiceInstanceId,b.hostedServiceInstanceId,b.nativeProjectId,b.nativeProjectRevision,b.actorId,b.installationId,b.hostedProjectId,b.apiProject,b.visibility]);
}
/** A reader refresh is not a new resource owner; Root still reauthorizes inspection. */
export function recoveryOwnerKey(b:Binding):string {
  bindingKey(b);
  return JSON.stringify([b.nativeLibraryId,b.nativeServiceInstanceId,b.hostedServiceInstanceId,b.authorityId,b.connectionId,b.actorId,b.installationId,b.nativeProjectId,b.hostedProjectId,b.visibility]);
}
export function isWrite(command: Command): command is WriteCommand {return writes.has(command.op);}
export function descriptor(c: Command, b: Binding): {method: "GET"|"POST"|"PATCH"; path: string; body?: unknown} {
  bindingKey(b);
  const fields:Record<string,readonly string[]>={catalog:["op","kind","offset","limit"],skill:["op","name"],archived:["op"],
    "proposal-counts":["op"],"proposal-page":["op","view","cursor"],proposal:["op","id","enrich"],"synthesis-status":["op"],
    "synthesis-models":["op"],pipeline:["op"],create:["op","reviewedAbsent","name","description","content"],
    save:["op","name","filePath","target","content","extra"],archive:["op","name","target"],restore:["op","name","target"],
    enable:["op","name","target"],disable:["op","name","target"],submit:["op","id","reviewed","reviewer","reason"],approve:["op","id","reviewed","reviewer","reason"],
    reject:["op","id","reviewed","reviewer","reason"],rollback:["op","id","reviewed","reviewer","reason"],
    "synthesis-run":["op","sessionId","model"]};
  if(!obj(c)||!Object.hasOwn(fields,c.op)||Object.keys(c).some(key=>!fields[c.op].includes(key)))throw new Error("This governance operation is not allowlisted.");
  const exactSubset=(value:unknown,keys:string[])=>obj(value)&&Object.keys(value).every(key=>keys.includes(key));
  if("target" in c&&!exactSubset(c.target,["id","revision"])||"extra" in c&&!exactSubset(c.extra,["tags","always_apply","files"])
    ||"reviewed" in c&&!exactSubset(c.reviewed,["status","updatedAt","targetSkillId","sourceProjectId","sourceName","expectedRevision","expectedSourceRevision","proposalHash","currentTarget","currentSource"])
    ||"model" in c&&c.model!==undefined&&!exactSubset(c.model,["providerId","modelId"]))throw new Error("Original command metadata is not allowlisted.");
  if("reviewed" in c) {
    const r=c.reviewed;
    const snapshot=(v:unknown,source=false)=>v===null||obj(v)&&Object.keys(v).length===(source?4:2)
      &&exactSubset(v,source?["id","revision","projectId","name"]:["id","revision"])
      &&text(v.id)&&int(v.revision)&&(!source||text(v.projectId)&&text(v.name));
    if(!obj(r)||typeof r.proposalHash!=="string"||!/^[0-9a-f]{64}$/.test(r.proposalHash)
      ||!snapshot(r.currentTarget)||!snapshot(r.currentSource,true))throw new Error("Exact reviewed proposal snapshots are required.");
  }
  const q = new URLSearchParams({project:b.apiProject}), esc=encodeURIComponent;
  const name = (v: string) => {if(!text(v)||v.length>64||v==="."||v===".."||/[\\/\u0000]/u.test(v))throw new Error("Invalid exact skill name.");return esc(v);};
  const id = (v: string) => {if(!text(v)||v.length>256||!/^[-A-Za-z0-9_]+$/.test(v))throw new Error("Invalid proposal identity.");return esc(v);};
  if("target" in c&&(!obj(c.target)||!text(c.target.id)||!int(c.target.revision)))throw new Error("The reviewed skill identity and revision are required.");
  if("reviewed" in c&&(!obj(c.reviewed)||!text(c.reviewed.status)||!text(c.reviewed.updatedAt)||!nullable(c.reviewed.targetSkillId)||!nullable(c.reviewed.sourceProjectId)||!nullable(c.reviewed.sourceName)||!(c.reviewed.expectedRevision===null||int(c.reviewed.expectedRevision))||!(c.reviewed.expectedSourceRevision===null||int(c.reviewed.expectedSourceRevision))))throw new Error("The original reviewed proposal metadata is required.");
  switch(c.op) {
    case "catalog": if(!["skill","plugin"].includes(c.kind)||!int(c.offset)||!int(c.limit)||c.limit<1||c.limit>100)throw new Error("Invalid catalog page.");q.set("kind",c.kind);q.set("visibility",b.visibility);q.set("offset",String(c.offset));q.set("limit",String(c.limit));return {method:"GET",path:"/api/v1/customize?"+q};
    case "skill": return {method:"GET",path:"/api/v1/skills/"+name(c.name)+"?"+q};
    case "archived": return {method:"GET",path:"/api/v1/skills/archived?"+q};
    case "create": if(c.reviewedAbsent!==true)throw new Error("A reviewed absent target is required; legacy create can upsert.");if(typeof c.description!=="string"||typeof c.content!=="string")throw new Error("Invalid skill body.");name(c.name);return {method:"POST",path:"/api/v1/skills?"+q,body:{name:c.name,description:c.description,content:c.content}};
    case "save": if(!text(c.filePath)||/[\\\u0000]/u.test(c.filePath)||c.filePath.split("/").some(p=>["",".",".."].includes(p)))throw new Error("Reviewed file metadata missing.");if(!("target" in c))throw new Error("Reviewed skill metadata missing.");name(c.name);if(typeof c.content!=="string"||!obj(c.extra)||!Number.isFinite(c.extra.always_apply)||c.extra.tags!==undefined&&typeof c.extra.tags!=="string"||c.extra.files!==undefined&&typeof c.extra.files!=="string")throw new Error("Invalid saved draft.");return {method:"PATCH",path:"/api/v1/skills/"+name(c.name)+"?"+q,body:{content:c.content,tags:c.extra.tags,always_apply:c.extra.always_apply,files:c.extra.files}};
    case "archive": case "restore": case "enable": case "disable": if(!("target" in c))throw new Error("Reviewed skill metadata missing.");return {method:"POST",path:"/api/v1/skills/"+name(c.name)+"/"+c.op+"?"+q};
    case "proposal-counts": return {method:"GET",path:"/api/v1/skills/proposals/counts?"+q};
    case "proposal-page": if(!["open","history"].includes(c.view))throw new Error("Invalid proposal view.");q.set("view",c.view);q.set("limit","25");if(c.cursor){if(!text(c.cursor)||c.cursor.length>4096)throw new Error("Invalid proposal cursor.");q.set("cursor",c.cursor);}return {method:"GET",path:"/api/v1/skills/proposals/page?"+q};
    case "proposal": if(c.enrich!==undefined&&typeof c.enrich!=="boolean")throw new Error("Invalid explicit enrichment choice.");if(c.enrich===false)q.set("enrich","false");return {method:"GET",path:"/api/v1/skills/proposals/"+id(c.id)+"?"+q};
    case "submit": case "approve": case "reject": case "rollback": if(!("reviewed" in c))throw new Error("Reviewed proposal metadata missing.");if(!text(c.reviewer)||c.reviewer.length>256||c.reason!==undefined&&typeof c.reason!=="string")throw new Error("A reviewer and valid reason are required.");return {method:"POST",path:"/api/v1/skills/proposals/"+id(c.id)+"/"+c.op+"?"+q,body:{reviewer:c.reviewer.trim(),reason:c.reason}};
    case "synthesis-status": return {method:"GET",path:"/api/v1/synthesis/status?"+q};
    case "synthesis-models": return {method:"GET",path:"/api/v1/synthesis/models?"+q};
    case "synthesis-run": if(c.sessionId){if(!/^[-A-Za-z0-9_]{1,256}$/.test(c.sessionId))throw new Error("Invalid synthesis session.");q.set("session_id",c.sessionId);}if(c.model&&(!text(c.model.providerId)||c.model.providerId.length>256||!text(c.model.modelId)||c.model.modelId.length>256))throw new Error("Invalid selected model.");return {method:"POST",path:"/api/v1/synthesis/run?"+q,body:c.model?{model:{providerId:c.model.providerId,modelId:c.model.modelId}}:{}};
    case "pipeline": q.set("limit","100");return {method:"GET",path:"/api/v1/pipeline/events?"+q};
    default: throw new Error("This governance operation is not allowlisted.");
  }
}
export function decodeSkill(value: unknown, binding: Binding): Skill {
  if(!obj(value)||!text(value.id)||value.project_id!==binding.hostedProjectId||!text(value.name)||typeof value.description!=="string"||typeof value.content!=="string"||!int(value.revision)
    || ![0,1].includes(Number(value.enabled))||typeof value.enabled!=="number"||!nullable(value.file_tree)||!nullable(value.tags)||!nullable(value.category)||!nullable(value.archived_at)
    ||typeof value.always_apply!=="number"||typeof value.created_at!=="string"||typeof value.updated_at!=="string")throw new Error("The hosted skill differs from the original project DTO.");
  if(value.file_tree!==null){let tree:unknown;try{tree=JSON.parse(value.file_tree as string);}catch{throw new Error("Hosted reference metadata is invalid; no source was edited.");}if(!obj(tree)||Object.values(tree).some(v=>typeof v!=="string"))throw new Error("Hosted reference metadata is invalid; no source was edited.");}
  return value as Skill;
}
function canonical(v: unknown): string { return JSON.stringify(v, (_key,value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b])=>a.localeCompare(b))) : value); }
function originalMatches(v: WriteOriginal, command: WriteCommand, b: Binding): boolean {
  return !!(v&&obj(v.command)&&typeof v.command.op==="string"&&Object.keys(v).length===3&&Object.keys(v).every(key=>["id","binding","command"].includes(key))&&text(v.id)&&bindingKey(v.binding)===bindingKey(b)&&canonical(v.command)===canonical(command));
}
export function createGovernanceClient(transport: BoundGovernanceTransport, viewIsCurrent: () => boolean = () => true) {
  if(!transport||!Array.isArray(transport.capabilities)||!["current","read","reserve","send","inspect","pending"].every(name=>typeof (transport as unknown as Record<string,unknown>)[name]==="function"))throw new Error("The authenticated original-operation transport is incomplete; no request was submitted.");
  const binding = Object.freeze(structuredClone(transport.binding)), key=bindingKey(binding);
  let disposed=false, busy=false;
  let held:WriteOriginal|null=null; // Ephemeral view barrier; durable retention belongs only to Root.
  const current=()=>{try{return !disposed&&viewIsCurrent()&&transport.current()&&bindingKey(transport.binding)===key;}catch{return false;}};
  const check=()=>{if(!current())throw Object.assign(new Error("Hosted authority changed; originals and drafts remain with their original owner."),{code:"STALE_AUTHORITY"});};
  const allowed=(op: Command["op"])=>current()&&transport.capabilities.includes(op);
  async function read(c: ReadCommand): Promise<unknown> {
    check();descriptor(c,binding);if(!allowed(c.op))throw Object.assign(new Error("This hosted read is unavailable for the original grant."),{status:403});
    const r=await transport.read(structuredClone(c),binding);check();if(bindingKey(r.binding)!==key)throw new Error("Cross-owner hosted response refused.");return structuredClone(r.value);
  }
  async function pending(): Promise<readonly WriteOriginal[]> {
    check();const rows=await transport.pending(binding);check();
    if(!Array.isArray(rows))throw new Error("Original-operation owner is unavailable.");
    // Foreign originals are preserved by Root, never silently queried or released here.
    for(const row of rows){if(!row||!originalMatches(row,row.command,row.binding)||recoveryOwnerKey(row.binding)!==recoveryOwnerKey(binding)||!isWrite(row.command))throw new Error("A foreign or malformed original requires owner recovery; writes are blocked.");descriptor(row.command,row.binding);}
    const retained=held;const returned=retained?rows.find(row=>row.id===retained.id):undefined;if(retained&&returned&&!originalMatches(returned,retained.command,retained.binding))throw new Error("The retained original changed; no new write is allowed.");
    if(held&&!rows.some(row=>row.id===held?.id))return [...rows,structuredClone(held)];
    return rows;
  }
  function receipt(r: OperationReceipt, original: WriteOriginal): OperationReceipt {
    if(!r||!originalMatches(r.original,original.command,original.binding)||r.original.id!==original.id||!["succeeded","refused","unknown"].includes(r.outcome))throw new Error("The operation receipt does not match its original.");
    if(r.error&&(!obj(r.error)||typeof r.error.message!=="string"||r.error.status!==undefined&&!int(r.error.status)||r.error.code!==undefined&&typeof r.error.code!=="string"))throw new Error("Invalid public original error.");
    return {original:structuredClone(original),outcome:r.outcome,...(r.value!==undefined?{value:structuredClone(r.value)}:{}),...(r.error?{error:{message:r.error.message.slice(0,600),...(r.error.status!==undefined?{status:r.error.status}:{}),...(r.error.code!==undefined?{code:r.error.code}:{})}}:{})};
  }
  async function mutate(c: WriteCommand): Promise<OperationReceipt> {
    check();descriptor(c,binding);if(!allowed(c.op))throw Object.assign(new Error("This change is unavailable for the original grant."),{status:403});
    if(busy)throw new Error("Another original is already being prepared.");busy=true;
    try {
      if((await pending()).length)throw new Error("An existing original must be inspected before another write.");
      check();const original=structuredClone(await transport.reserve(structuredClone(c),binding));
      if(!originalMatches(original,c,binding))throw new Error("The reserved original does not match the reviewed command.");
      held=structuredClone(original);
      // Root retained the original BEFORE dispatch. A stale view never sends it.
      check();
      try {const r=await transport.send(original);check();const verified=receipt(r,original);if(verified.outcome!=="unknown")held=null;return verified;}
      catch(error){if(!current())throw error;return {original,outcome:"unknown",error:{message:error instanceof Error?error.message:"Dispatch outcome is unknown."}};}
    } finally {busy=false;}
  }
  async function inspect(original: WriteOriginal) {
    check();if(!originalMatches(original,original.command,original.binding)||recoveryOwnerKey(original.binding)!==recoveryOwnerKey(binding))throw new Error("Only this exact original resource owner can be inspected.");
    const r=await transport.inspect(original);check();const verified=receipt(r,original);if(verified.outcome!=="unknown"&&held?.id===original.id)held=null;return verified;
  }
  async function catalog(kind: "skill"|"plugin"="skill"):Promise<CatalogRow[]> {
    const rows:CatalogRow[]=[],seen=new Set<string>();let total:number|null=null;
    for(let offset=0;offset<10000;offset+=100) {
      const r=await read({op:"catalog",kind,offset,limit:100});
      if(!obj(r)||!obj(r.scope)||r.scope.kind!=="project"||r.scope.projectId!==binding.hostedProjectId||!Array.isArray(r.scopes)||!r.scopes.includes(binding.visibility)||!obj(r.pagination)||!Array.isArray(r.data))throw new Error("Catalog scope differs from the bound owner.");
      const p=r.pagination;if(p.offset!==offset||p.limit!==100||!int(p.total)||typeof p.hasMore!=="boolean"||r.data.length>100||total!==null&&p.total!==total)throw new Error("Unstable hosted pagination.");total=p.total;
      for(const row of r.data){if(!obj(row)||!text(row.id)||seen.has(row.id)||row.kind!==kind||row.visibility!==binding.visibility||typeof row.name!=="string"||typeof row.description!=="string"||typeof row.category!=="string"||typeof row.installed!=="boolean"||typeof row.enabled!=="boolean"||typeof row.archived!=="boolean"||!row.installed&&(row.enabled||row.archived)||!Array.isArray(row.actions)||row.actions.some(a=>typeof a!=="string")||!(row.revision===null||int(row.revision)))throw new Error("Invalid hosted catalog row.");seen.add(row.id);rows.push(row as CatalogRow);}
      if(!p.hasMore){if(rows.length!==total)throw new Error("Incomplete hosted catalog.");return rows;}if(!r.data.length||rows.length>=total)throw new Error("Hosted pagination did not advance.");
    }throw new Error("Hosted catalog exceeds the bounded read limit.");
  }
  async function skill(name:string,expectedId?:string):Promise<Skill> {const r=await read({op:"skill",name});if(!obj(r))throw new Error("Skill response unavailable.");const s=decodeSkill(r.data,binding);if(s.name!==name||expectedId!==undefined&&s.id!==expectedId)throw new Error("Skill identity differs from the original request; refresh the catalog before review.");return s;}
  return {binding,key,current,allowed,read,pending,mutate,inspect,catalog,skill,dispose(){disposed=true;}};
}
export type GovernanceClient=ReturnType<typeof createGovernanceClient>;
