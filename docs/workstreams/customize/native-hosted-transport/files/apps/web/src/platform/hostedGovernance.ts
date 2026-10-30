import type {Project} from "@veyra/contracts";
import type {Gateway} from "./types";
import type {Binding,BoundGovernanceTransport,Operation,OperationReceipt,ReadCommand,WriteCommand,WriteOriginal} from "../features/customize/hosted-governance/contracts";

export type NativeHostedSelection=Readonly<{libraryId:string;serviceInstanceId:string;connectionId:string;project:Project|null}>;
const fields=["authorityId","connectionId","grantId","grantRevision","epoch","nativeLibraryId","nativeServiceInstanceId","hostedServiceInstanceId","nativeProjectId","nativeProjectRevision","actorId","installationId","hostedProjectId","apiProject","visibility"];
const operations:readonly Operation[]=["catalog","skill","archived","proposal-counts","proposal-page","proposal","synthesis-status","synthesis-models","pipeline","create","save","archive","restore","enable","disable","approve","reject","rollback","submit","synthesis-run"];
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const nonempty=(v:unknown):v is string=>typeof v==="string"&&!!v.trim()&&v.length<=4096&&!/[\u0000-\u001f]/.test(v);
function binding(value:unknown):Binding{
 if(!record(value)||Object.keys(value).length!==fields.length||Object.keys(value).some(k=>!fields.includes(k)))throw new Error("Invalid hosted owner context");
 for(const key of fields.filter(k=>!["nativeProjectId","nativeProjectRevision","grantRevision","visibility"].includes(k)))if(!nonempty(value[key]))throw new Error("Invalid hosted owner identity");
 if(!Number.isSafeInteger(value.grantRevision)||(value.grantRevision as number)<1||!["project","system"].includes(value.visibility as string)||
 !(value.nativeProjectId===null&&value.nativeProjectRevision===null||nonempty(value.nativeProjectId)&&Number.isSafeInteger(value.nativeProjectRevision)&&(value.nativeProjectRevision as number)>=0))throw new Error("Invalid hosted grant/project context");
 return Object.freeze(structuredClone(value)) as Binding;
}
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,v)=>record(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const key=(value:Binding)=>JSON.stringify(fields.map(k=>value[k as keyof Binding]));
const selectionKey=(s:NativeHostedSelection)=>JSON.stringify([s.libraryId,s.serviceInstanceId,s.connectionId,s.project]);
const recoveryKey=(b:Binding)=>JSON.stringify([b.nativeLibraryId,b.nativeServiceInstanceId,b.hostedServiceInstanceId,b.authorityId,b.connectionId,b.actorId,b.installationId,b.nativeProjectId,b.hostedProjectId,b.visibility]);
function original(value:unknown):WriteOriginal{
 if(!record(value)||Object.keys(value).length!==3||Object.keys(value).some(k=>!["id","binding","command"].includes(k))||!nonempty(value.id)||!record(value.command)||!operations.includes(value.command.op as Operation))throw new Error("Invalid retained hosted original");
 return {id:value.id,binding:binding(value.binding),command:structuredClone(value.command) as WriteCommand};
}
/** Concrete Native authenticated gateway consumer. No renderer endpoint, token, cookie or fetch. */
export async function connectHostedGovernance(gateway:Pick<Gateway,"workbench">,selection:NativeHostedSelection,
 currentSelection:()=>NativeHostedSelection|null):Promise<BoundGovernanceTransport>{
 if(!gateway.workbench||![selection.libraryId,selection.serviceInstanceId,selection.connectionId].every(nonempty))throw new Error("The existing native connection owner is unavailable");
 const initial=structuredClone(selection),selected=selectionKey(initial),request=gateway.workbench;
 const isSelected=()=>{try{const actual=currentSelection();return !!actual&&selectionKey(actual)===selected;}catch{return false;}};
 const check=()=>{if(!isSelected())throw new Error("Native connection or project changed");};
 const path="/v1/remote-control/connections/"+encodeURIComponent(initial.connectionId)+"/hosted-governance";
 check();
 const response=await request("POST",path+"/context",{library_id:initial.libraryId,service_instance_id:initial.serviceInstanceId,project:initial.project},isSelected);
 check();
 if(!record(response)||Object.keys(response).some(k=>!["binding","capabilities","protocol"].includes(k))||response.protocol!=="node_hosted_governance_v1"||!Array.isArray(response.capabilities)||
 response.capabilities.some(v=>!operations.includes(v as Operation))||new Set(response.capabilities).size!==response.capabilities.length)throw new Error("The saved connection has no validated hosted capability");
 const b=binding(response.binding),owner=key(b),capabilities=Object.freeze([...response.capabilities]) as readonly Operation[];
 if(b.nativeLibraryId!==initial.libraryId||b.nativeServiceInstanceId!==initial.serviceInstanceId||b.connectionId!==initial.connectionId||
 b.nativeProjectId!==(initial.project?.id??null)||b.nativeProjectRevision!==(initial.project?.revision??null))throw new Error("Hosted context does not belong to this exact native owner");
 const current=()=>isSelected()&&key(b)===owner;
 async function call(operation:string,body:unknown):Promise<unknown>{check();const value=await request("POST",path+"/"+operation,body,current);check();return value;}
 function samePublicOriginal(value:unknown,expected:WriteOriginal):WriteOriginal{
   const actual=original(value);
   if(canonical(actual)!==canonical(expected))throw new Error("Hosted original changed");
   return actual;
 }
 async function inspectOriginal(o:WriteOriginal):Promise<OperationReceipt>{
   if(recoveryKey(binding(o.binding))!==recoveryKey(b))throw new Error("Foreign hosted original");
   const value=await call("inspect",{binding:b,original:o});
   if(!record(value)||!["succeeded","refused","unknown"].includes(value.outcome as string))throw new Error("Invalid original receipt");
   return {...value,original:samePublicOriginal(value.original,o)} as OperationReceipt;
 }
 return {binding:b,capabilities,current,
   async read(command:ReadCommand,currentBinding:Binding){if(key(currentBinding)!==owner)throw new Error("Stale hosted read owner");const value=await call("read",{binding:b,command});if(!record(value)||key(binding(value.binding))!==owner||!Object.hasOwn(value,"value"))throw new Error("Invalid original read envelope");return {binding:b,value:value.value};},
   async reserve(command:WriteCommand,currentBinding:Binding){if(key(currentBinding)!==owner)throw new Error("Stale hosted reserve owner");const value=original(await call("reserve",{binding:b,command}));if(key(value.binding)!==owner||canonical(value.command)!==canonical(command))throw new Error("Reservation differs from the requested original");return value;},
   async send(o:WriteOriginal){if(key(binding(o.binding))!==owner)throw new Error("Stale hosted dispatch owner");const value=await call("send",{binding:b,original:o});if(!record(value)||!["succeeded","refused","unknown"].includes(value.outcome as string))throw new Error("Invalid original receipt");return {...value,original:samePublicOriginal(value.original,o)} as OperationReceipt;},
   inspect:inspectOriginal,
   async pending(currentBinding:Binding){if(key(currentBinding)!==owner)throw new Error("Stale hosted pending owner");const value=await call("pending",{binding:b});if(!Array.isArray(value))throw new Error("Original index unavailable");const rows=value.map(original);if(new Set(rows.map(o=>o.id)).size!==rows.length||rows.some(o=>recoveryKey(o.binding)!==recoveryKey(b)))throw new Error("Foreign or conflicting original index");return rows;}
 };
}
