import type {Gateway} from './types';
import type {NativeHostedSelection} from './hostedGovernance';
import type {Binding} from '../features/customize/hosted-governance/contracts';
export const protocol='customize-scoped-v1' as const;
export const scopes=['project','personal','public','system'] as const;
export const verbs=['discover','source','project-source','archived-plugins','installations','operation','pending','publish','withdraw','restore-source','revise-plugin-source','connect','archive-plugin','restore-plugin','activate-plugin','deactivate-plugin','reconcile-plugin-projection','reconcile-local-metadata'] as const;
export type Scope=typeof scopes[number];export type Verb=typeof verbs[number];
export type Json=Record<string,unknown>;
export type Selection={scopes:Scope[];verbs:Verb[]};
export type ScopedBinding={protocol:typeof protocol;consentId:string;consentRevision:number;consentRequestSha256:string;baseBinding:Binding;selection:Selection;capabilities:Verb[];localProfileRevision:number;parentProfileRevision:number};
export type Original={protocol:typeof protocol;id:string;consentId:string;consentRevision:number;consentRequestSha256:string;baseBinding:Binding;command:Json};
export type Result={original:Original;outcome:'succeeded'|'refused'|'unknown';receipt:Json;recovery?:Json};
export const record=(v:unknown):v is Json=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=():never=>{throw Error('The scoped owner returned an invalid response');};
export const canonical=(v:unknown):string=>JSON.stringify(v,(_key,x)=>record(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v:unknown):v is number=>Number.isInteger(v)&&Number(v)>=1&&Number(v)<=4294967295;
const bindingFields=['authorityId','connectionId','grantId','grantRevision','epoch','nativeLibraryId','nativeServiceInstanceId','hostedServiceInstanceId','nativeProjectId','nativeProjectRevision','actorId','installationId','hostedProjectId','apiProject','visibility'];
function binding(v:unknown):Binding{
 if(!record(v)||Object.keys(v).length!==bindingFields.length||Object.keys(v).some(k=>!bindingFields.includes(k)))return fail();
 for(const k of bindingFields.filter(k=>!['grantRevision','nativeProjectId','nativeProjectRevision','visibility'].includes(k)))if(typeof v[k]!=='string'||!(v[k] as string).length||(v[k] as string).length>256||/[\u0000-\u001f]/.test(v[k] as string))return fail();
 if(!Number.isInteger(v.grantRevision)||Number(v.grantRevision)<0||Number(v.grantRevision)>4294967295||!['project','system'].includes(String(v.visibility))||!(v.nativeProjectId===null&&v.nativeProjectRevision===null||typeof v.nativeProjectId==='string'&&Number.isInteger(v.nativeProjectRevision)&&Number(v.nativeProjectRevision)>=0))return fail();return structuredClone(v) as Binding;
}
function selection(v:unknown):Selection{
 if(!record(v)||Object.keys(v).sort().join(',')!=='scopes,verbs'||!Array.isArray(v.scopes)||!Array.isArray(v.verbs)||!v.scopes.length||!v.verbs.length||v.scopes.some(s=>!scopes.includes(s))||v.verbs.some(s=>!verbs.includes(s))||new Set(v.scopes).size!==v.scopes.length||new Set(v.verbs).size!==v.verbs.length)return fail();return structuredClone(v) as Selection;
}
function original(v:unknown,owner:Pick<ScopedBinding,'consentId'|'consentRevision'|'consentRequestSha256'|'baseBinding'>):Original{
 if(!record(v)||Object.keys(v).sort().join(',')!=='baseBinding,command,consentId,consentRequestSha256,consentRevision,id,protocol'||v.protocol!==protocol||!uuid(v.id)||v.consentId!==owner.consentId||v.consentRevision!==owner.consentRevision||v.consentRequestSha256!==owner.consentRequestSha256||canonical(binding(v.baseBinding))!==canonical(owner.baseBinding)||!record(v.command)||v.command.operationId!==v.id||!verbs.includes(v.command.op as Verb))return fail();return structuredClone(v) as Original;
}
async function digest(v:unknown):Promise<string>{const bytes=new TextEncoder().encode(canonical(v));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}
export type BoundScopedTransport=Readonly<{context:ScopedBinding;current:()=>boolean;allows:(verb:Verb)=>boolean;read:(verb:Verb,query:Json)=>Promise<unknown>;reserve:(command:Json)=>Promise<Original>;send:(original:Original)=>Promise<Result>;inspect:(original:Original)=>Promise<Result>;pending:()=>Promise<Original[]>}>;
/** Fixed authenticated Native gateway calls. Renderer supplies no HTTP endpoint, token or cookie. */
export function scopedNativeOwner(gateway:Pick<Gateway,'workbench'>,selectionValue:NativeHostedSelection,currentSelection:()=>NativeHostedSelection|null){
 const initial=structuredClone(selectionValue),key=canonical(initial),request=gateway.workbench;if(!request)throw Error('Native service is unavailable');
 const current=()=>{try{return canonical(currentSelection())===key;}catch{return false;}};
 const check=()=>{if(!current())throw Error('Native owner changed; refresh this catalog');};
 const base='/v1/remote-control/connections/'+encodeURIComponent(initial.connectionId)+'/customize-scoped-v1';
 async function call(action:string,body:unknown){check();const result=await request!('POST',base+'/'+action,body,current);check();return result;}
 async function context(){const result=await call('context',{library_id:initial.libraryId,service_instance_id:initial.serviceInstanceId,project:initial.project});if(!record(result)||result.protocol!==protocol||!record(result.review)||!hash(result.reviewSha256)||!Array.isArray(result.consents))return fail();
  const b=binding(result.review.baseBinding);if(b.nativeLibraryId!==initial.libraryId||b.nativeServiceInstanceId!==initial.serviceInstanceId||b.connectionId!==initial.connectionId||b.nativeProjectId!==(initial.project?.id??null)||b.nativeProjectRevision!==(initial.project?.revision??null))return fail();selection(result.review.offered);return result as Json&{review:Json;reviewSha256:string;consents:Json[]};}
 async function bind(consentId:string,baseBinding:Binding):Promise<BoundScopedTransport>{
  if(!uuid(consentId))return fail();const result=await call('binding',{consentId,baseBinding});
  if(!record(result)||result.protocol!==protocol||result.consentId!==consentId||!integer(result.consentRevision)||!hash(result.consentRequestSha256)||!integer(result.localProfileRevision)||!integer(result.parentProfileRevision)||canonical(binding(result.baseBinding))!==canonical(baseBinding)||!Array.isArray(result.capabilities)||new Set(result.capabilities).size!==result.capabilities.length)return fail();
  const chosen=selection(result.selection);if(result.capabilities.some(v=>!chosen.verbs.includes(v)))return fail();const owner=structuredClone(result) as ScopedBinding;
  const allows=(verb:Verb)=>current()&&owner.capabilities.includes(verb);
  async function receipt(value:unknown,expected:Original):Promise<Result>{
   if(!record(value)||canonical(original(value.original,owner))!==canonical(expected)||!['succeeded','refused','unknown'].includes(String(value.outcome))||!record(value.receipt)||value.receipt.protocol!==protocol||value.receipt.operationId!==expected.id||value.receipt.consentId!==owner.consentId||value.receipt.nativeRequestSha256!==await digest(expected)||value.receipt.outcome!==value.outcome)return fail();return structuredClone(value) as Result;
  }
  return {context:owner,current,allows,
   async read(verb,query){if(!allows(verb))throw Error('This read is unavailable under the current consent');const result=await call('read',{protocol,consentId,consentRevision:owner.consentRevision,verb,query});if(!record(result)||result.protocol!==protocol||result.consentId!==consentId||result.consentRevision!==owner.consentRevision||!Object.hasOwn(result,'value'))return fail();return result.value;},
   async reserve(command){if(!allows(command.op as Verb)||Object.hasOwn(command,'operationId'))throw Error('This command is unavailable under the current consent');const value=original(await call('reserve',{consentId,baseBinding:owner.baseBinding,command}),owner);const {operationId:_id,...reserved}=value.command;if(canonical(reserved)!==canonical(command))return fail();return value;},
   async send(value){original(value,owner);return receipt(await call('send',{original:value}),value);},
   async inspect(value){original(value,owner);return receipt(await call('inspect',{original:value}),value);},
   async pending(){const value=await call('pending',{consentId,baseBinding:owner.baseBinding});if(!record(value)||value.protocol!==protocol||value.consentId!==consentId||!Array.isArray(value.originals))return fail();const originals=value.originals.map(v=>original(v,owner));if(new Set(originals.map(o=>o.id)).size!==originals.length)return fail();return originals;}
  };
 }
 function recoverySelector(c:Json){if(!uuid(c.consentId)||!integer(c.revision)||!hash(c.requestSha256))return fail();return {consentId:c.consentId,consentRevision:c.revision,consentRequestSha256:c.requestSha256,baseBinding:binding(c.baseBinding)};}
 return {current,context,bind,async consent(command:Json){return call("consents",command);},
  async reconcileConsent(c:Json){const selector=recoverySelector(c);return call("consent-reconciliation",{operationId:crypto.randomUUID(),consentId:selector.consentId,sourceOperationId:selector.consentId,requestSha256:selector.consentRequestSha256});},
  async revokeConsent(c:Json){const selector=recoverySelector(c);return call("consent-revocation",{operationId:crypto.randomUUID(),consentId:selector.consentId,requestSha256:selector.consentRequestSha256});},
  async recoveryPending(c:Json){const selector=recoverySelector(c),value=await call("pending",{consentId:selector.consentId,baseBinding:selector.baseBinding});if(!record(value)||value.protocol!==protocol||value.consentId!==selector.consentId||value.liveBinding!==false||!Array.isArray(value.originals))return fail();return value.originals.map(v=>original(v,selector));},
  async recoveryInspect(c:Json,expected:Original){const selector=recoverySelector(c);original(expected,selector);const value=await call("inspect",{original:expected});if(!record(value)||canonical(original(value.original,selector))!==canonical(expected)||!record(value.receipt)||value.receipt.protocol!==protocol||value.receipt.operationId!==expected.id||value.receipt.consentId!==selector.consentId||value.receipt.nativeRequestSha256!==await digest(expected)||value.receipt.outcome!==value.outcome||!["succeeded","refused","unknown"].includes(String(value.outcome)))return fail();return structuredClone(value) as Result;}
 };
}