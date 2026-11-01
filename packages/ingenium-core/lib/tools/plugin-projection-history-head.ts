/** DATA ONLY. Trusted caller supplies a complete, closed historical read, never public request proof.
 * Hash/lineage consistency grants no authority, physical readback, restore creation or activation.
 * Proposed restore/v2 protocols below require an actual future owner; this module does not mint them.
 */
import {createHash} from 'node:crypto';
type Json=Record<string,any>;
export type ClosedHistoricalRecord={id:string;projectId:string;installationId:string;originalJson:string;originalSha256:string;firstReceiptJson:string|null;firstReceiptSha256:string|null};
export type ClosedHistoryInput={domain:'closed-historical-records-v1';projectId:string;installationId:string;namespaces:readonly ClosedHistoricalRecord[];restores:readonly ClosedHistoricalRecord[]};
export type HeadMetadata={metadataOnly:true;state:'eligible'|'setup-required';namespaceId:string|null;namespaceGeneration:number|null;restoreOriginalId:string|null;restoreEpoch:number;setup:'base-absent'|'absent'|'skipped'|'initialize'|'namespace'};
export class HistoryHeadRefusal extends Error{constructor(public code:string){super(code);}}
function need(v:unknown,code:string):asserts v{if(!v)throw new HistoryHeadRefusal(code);}
/** Same sorted JSON hash semantics as immutable Core originals; not a public proof constructor. */
function hash(v:unknown):string{return createHash('sha256').update(JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x)).digest('hex');}
function object(text:string):Json{try{const v=JSON.parse(text);need(v&&typeof v==='object'&&!Array.isArray(v),'INVALID_HISTORY_JSON');return v;}catch{throw new HistoryHeadRefusal('INVALID_HISTORY_JSON');}}
function integer(v:unknown):v is number{return Number.isSafeInteger(v)&&Number(v)>0;}
function checked(r:ClosedHistoricalRecord,input:ClosedHistoryInput){
 need(typeof r.id==='string'&&r.id.length>0&&r.projectId===input.projectId&&r.installationId===input.installationId,'HISTORY_OWNER_MISMATCH');
 const o=object(r.originalJson);need(/^[a-f0-9]{64}$/.test(r.originalSha256)&&hash(o)===r.originalSha256,'ORIGINAL_HASH_MISMATCH');
 need(o.id===r.id&&o.projectId===r.projectId&&o.installationId===r.installationId,'ORIGINAL_OWNER_MISMATCH');
 need(typeof r.firstReceiptJson==='string'&&typeof r.firstReceiptSha256==='string','PENDING_HISTORY_RECORD');const receipt=object(r.firstReceiptJson);
 need(/^[a-f0-9]{64}$/.test(r.firstReceiptSha256)&&hash(receipt)===r.firstReceiptSha256,'FIRST_RECEIPT_HASH_MISMATCH');
 need(receipt.operationId===r.id&&receipt.payloadSha256===r.originalSha256&&receipt.outcome==='succeeded'&&receipt.value&&typeof receipt.value==='object','FIRST_RECEIPT_NOT_SUCCEEDED');
 need(receipt.value.projectId===r.projectId,'FIRST_RECEIPT_OWNER_MISMATCH');return {o,value:receipt.value as Json,id:r.id};
}
/** Closed input consistency only. Missing records cannot be detected without the trusted caller's closed read. */
export function validateClosedProjectionHistory(input:ClosedHistoryInput):HeadMetadata{
 need(input.domain==='closed-historical-records-v1'&&typeof input.projectId==='string'&&input.projectId.length>0&&typeof input.installationId==='string'&&input.installationId.length>0&&Array.isArray(input.namespaces)&&Array.isArray(input.restores),'CLOSED_HISTORY_INPUT_REQUIRED');
 const ids=[...input.namespaces,...input.restores].map(r=>r.id);need(new Set(ids).size===ids.length,'DUPLICATE_HISTORY_ID');
 const ns=input.namespaces.map(r=>{const c=checked(r,input),v1=c.o.protocol==='plugin-projection-transition-v1';need(v1||c.o.protocol==='plugin-projection-namespace-head-v2','NAMESPACE_PROTOCOL_UNAVAILABLE');
  need(c.value.protocol==='plugin-projection-namespace-v1','NAMESPACE_FIRST_RECEIPT_PROTOCOL');
  if(v1){need(!['namespaceGeneration','previousNamespaceId','restoreOriginalId','restoreEpoch'].some(k=>Object.hasOwn(c.o,k)),'AMBIGUOUS_V1_NAMESPACE');return {...c,generation:1,previous:null as string|null,epoch:0,restore:null as string|null,v1};}
  need(integer(c.o.namespaceGeneration)&&(c.o.previousNamespaceId===null||typeof c.o.previousNamespaceId==='string')&&Number.isSafeInteger(c.o.restoreEpoch)&&c.o.restoreEpoch>=0&&(c.o.restoreOriginalId===null||typeof c.o.restoreOriginalId==='string'),'INVALID_NAMESPACE_LINK');
  need(c.value.namespaceGeneration===c.o.namespaceGeneration&&c.value.previousNamespaceId===c.o.previousNamespaceId&&c.value.restoreOriginalId===c.o.restoreOriginalId&&c.value.restoreEpoch===c.o.restoreEpoch,'NAMESPACE_RECEIPT_LINK_MISMATCH');
  return {...c,generation:c.o.namespaceGeneration as number,previous:c.o.previousNamespaceId as string|null,epoch:c.o.restoreEpoch as number,restore:c.o.restoreOriginalId as string|null,v1};});
 const rs=input.restores.map(r=>{const c=checked(r,input);need(c.o.protocol==='plugin-projection-restore-original-v1'&&c.value.protocol==='plugin-projection-restore-observation-v1','RESTORE_PROTOCOL_UNAVAILABLE');
  need(integer(c.o.restoreEpoch)&&(c.o.previousRestoreOriginalId===null||typeof c.o.previousRestoreOriginalId==='string')&&(c.o.previousNamespaceId===null||typeof c.o.previousNamespaceId==='string')&&['absent','skipped','initialize'].includes(c.o.setupDecision),'INVALID_RESTORE_LINK');
  for(const k of ['restoreEpoch','previousRestoreOriginalId','previousNamespaceId','setupDecision'])need(c.o[k]===c.value[k],'RESTORE_RECEIPT_LINK_MISMATCH');return {...c,epoch:c.o.restoreEpoch as number,previous:c.o.previousRestoreOriginalId as string|null,namespace:c.o.previousNamespaceId as string|null,setup:c.o.setupDecision as 'absent'|'skipped'|'initialize'};});
 // Sort only by validated ordinal metadata, never timestamps/row ordering. Exact links must prove a single chain.
 ns.sort((a,b)=>a.generation-b.generation);rs.sort((a,b)=>a.epoch-b.epoch);
 for(let i=0;i<ns.length;i++){const n=ns[i]!,p=ns[i-1];need(n.generation===i+1&&n.previous===(p?.id??null),'NAMESPACE_FORK_CYCLE_GAP_OR_MISSING_LINK');
  if(n.epoch===0)need(!p&&n.restore===null,'NAMESPACE_BASE_REQUIRED');else if(p)need(n.epoch>p.epoch&&!n.v1,'NAMESPACE_RESTORE_EPOCH_NOT_ADVANCED');
  if(n.epoch>0){const r=rs.find(r=>r.epoch===n.epoch);need(r&&r.id===n.restore&&r.namespace===n.previous,'NAMESPACE_RESTORE_BINDING_MISMATCH');need(r.setup!=='skipped','RESTORE_SETUP_SKIPPED');}}
 for(let i=0;i<rs.length;i++){const r=rs[i]!,p=rs[i-1];need(r.epoch===i+1&&r.previous===(p?.id??null),'RESTORE_FORK_CYCLE_GAP_OR_MISSING_LINK');const prior=ns.filter(n=>n.epoch<r.epoch).at(-1);need(r.namespace===(prior?.id??null),'RESTORE_PREVIOUS_NAMESPACE_MISMATCH');}
 const n=ns.at(-1),r=rs.at(-1),eligible=!!n&&(!r||n.epoch===r.epoch&&n.restore===r.id);
 return {metadataOnly:true,state:eligible?'eligible':'setup-required',namespaceId:eligible?n!.id:null,namespaceGeneration:eligible?n!.generation:null,restoreOriginalId:r?.id??null,restoreEpoch:r?.epoch??0,setup:eligible?'namespace':r?.setup??'base-absent'};
}
