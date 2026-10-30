import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const directory=path.dirname(fileURLToPath(import.meta.url));
const checkout=path.resolve(directory,"../../../..");
export const source=path.join(checkout,"packages/veyra-customize/hosted-governance");
export function transformed(name){
 let s=fs.readFileSync(path.join(source,name),"utf8");
 function once(before,after){if(s.split(before).length!==2)throw new Error("Compatibility preimage mismatch: "+name+": "+before.slice(0,90));s=s.replace(before,after);}
 if(name==="contracts.ts"){
  const fields='{status:string;updatedAt:string;targetSkillId:string|null;sourceProjectId:string|null;sourceName:string|null;expectedRevision:number|null;expectedSourceRevision:number|null}';
  once('export type Binding =','export type Reviewed = {status:string;updatedAt:string;targetSkillId:string|null;sourceProjectId:string|null;sourceName:string|null;expectedRevision:number|null;expectedSourceRevision:number|null;currentTarget:{id:string;revision:number}|null;currentSource:{id:string;projectId:string;name:string;revision:number}|null;proposalHash:string};\nexport type Binding =');
  once('currentSkill?: {content: string; revision: number} | null; sourceSkill?: {projectId:string; content: string; revision: number; name: string} | null','reviewed?: Reviewed; currentSkill?: {id?:string;content: string; revision: number} | null; sourceSkill?: {id?:string;projectId:string; content: string; revision: number; name: string} | null');
  once('op: "approve" | "reject" | "rollback"','op: "submit" | "approve" | "reject" | "rollback"');
  once('reviewed: '+fields,'reviewed: Reviewed');
 }
 if(name==="client.ts"){
  once('"approve","reject","rollback","synthesis-run"','"submit","approve","reject","rollback","synthesis-run"');
  once('approve:["op","id","reviewed","reviewer","reason"],','submit:["op","id","reviewed","reviewer","reason"],approve:["op","id","reviewed","reviewer","reason"],');
  once('["status","updatedAt","targetSkillId","sourceProjectId","sourceName","expectedRevision","expectedSourceRevision"]','["status","updatedAt","targetSkillId","sourceProjectId","sourceName","expectedRevision","expectedSourceRevision","currentTarget","currentSource","proposalHash"]');
  once('  switch(c.op) {','  if("reviewed" in c){const r=c.reviewed;const target=(v:unknown)=>v===null||obj(v)&&exactSubset(v,["id","revision"])&&text(v.id)&&int(v.revision);const source=(v:unknown)=>v===null||obj(v)&&exactSubset(v,["id","projectId","name","revision"])&&text(v.id)&&text(v.projectId)&&text(v.name)&&int(v.revision);if(typeof r.proposalHash!=="string"||!/^[a-f0-9]{64}$/.test(r.proposalHash)||!Object.hasOwn(r,"currentTarget")||!Object.hasOwn(r,"currentSource")||!target(r.currentTarget)||!source(r.currentSource))throw new Error("Actual current-row comparisons and proposal fingerprint are required.");}\n  switch(c.op) {');
  once('case "approve": case "reject": case "rollback":','case "submit": case "approve": case "reject": case "rollback":');
 }
 if(name==="decoders.ts"){
  const review=[
   '  if(v.reviewed!==undefined){',
   '    const r=v.reviewed,keys=["status","updatedAt","targetSkillId","sourceProjectId","sourceName","expectedRevision","expectedSourceRevision","currentTarget","currentSource","proposalHash"];',
   '    if(!record(r)||Object.keys(r).length!==keys.length||Object.keys(r).some(k=>!keys.includes(k))||typeof r.proposalHash!=="string"||!/^[a-f0-9]{64}$/.test(r.proposalHash))throw new Error("Invalid actual-row review.");',
   '    const expected={status:v.status==="rolledBack"?"rolled_back":v.status,updatedAt:v.updatedAt,targetSkillId:v.targetSkillId,sourceProjectId:v.sourceProjectId,sourceName:v.sourceName,expectedRevision:v.expectedRevision,expectedSourceRevision:v.expectedSourceRevision};',
   '    if(Object.entries(expected).some(([k,value])=>r[k]!==value))throw new Error("Review differs from proposal baselines.");',
   '    if(r.currentTarget===null){if(v.currentSkill!==null)throw new Error("Target absence was not returned by owner.");}',
   '    else if(!record(r.currentTarget)||Object.keys(r.currentTarget).sort().join(",")!=="id,revision"||!record(v.currentSkill)||typeof v.currentSkill.id!=="string"||r.currentTarget.id!==v.currentSkill.id||r.currentTarget.revision!==v.currentSkill.revision||!integer(r.currentTarget.revision))throw new Error("Actual target comparison is unavailable.");',
   '    if(r.currentSource===null){if(v.sourceSkill!==null&&v.sourceSkill!==undefined)throw new Error("Source absence differs from owner.");}',
   '    else if(!record(r.currentSource)||Object.keys(r.currentSource).sort().join(",")!=="id,name,projectId,revision"||!record(v.sourceSkill)||typeof v.sourceSkill.id!=="string"||r.currentSource.id!==v.sourceSkill.id||r.currentSource.projectId!==v.sourceSkill.projectId||r.currentSource.name!==v.sourceSkill.name||r.currentSource.revision!==v.sourceSkill.revision||!integer(r.currentSource.revision))throw new Error("Actual source comparison is unavailable.");',
   '  }',
   '  return v as ProposalDetail;'
  ].join("\n");
  once('  return v as ProposalDetail;',review);
 }
 if(name==="HostedGovernance.tsx"){
  once('verified=command.op==="approve"?actual.status==="applied":','verified=command.op==="submit"?actual.status==="pending":command.op==="approve"?actual.status==="applied":');
  once('["approve","reject","rollback"] as const','["submit","approve","reject","rollback"] as const');
  once('disabled={!can(op)||!reviewer.trim()||(op==="rollback"?detail.status!=="applied":!["pending","draft"].includes(detail.status))||detail.proposalType==="merge"&&op!=="reject"&&!detail.sourceSkill}',
   'disabled={!can(op)||!reviewer.trim()||!detail.reviewed||(op==="submit"?detail.status!=="draft":op==="rollback"?detail.status!=="applied":detail.status!=="pending")||detail.proposalType==="merge"&&!detail.reviewed?.currentSource||detail.targetSkillId!==null&&!detail.reviewed?.currentTarget}');
  once('onClick={()=>requestConfirmation({op,id:detail.id,reviewed:{status:detail.status,updatedAt:detail.updatedAt,targetSkillId:detail.targetSkillId,sourceProjectId:detail.sourceProjectId,sourceName:detail.sourceName,expectedRevision:detail.expectedRevision,expectedSourceRevision:detail.expectedSourceRevision},reviewer,reason})}',
   'onClick={()=>{if(detail.reviewed)requestConfirmation({op,id:detail.id,reviewed:detail.reviewed,reviewer,reason});}}');
  once('{op==="approve"?"Approve & apply":','{op==="submit"?"Submit for review":op==="approve"?"Approve & apply":');
  once('{(["submit","approve"', '{!detail.reviewed&&<p role="status">Current row comparisons are unavailable. Load enriched details before a review action.</p>}\n          {(["submit","approve"');
 }
 if(name==="verification.ts"){
  once('op:"approve"|"reject"|"rollback"','op:"submit"|"approve"|"reject"|"rollback"');
  once('return op==="approve"','return op==="submit"?status==="pending":op==="approve"');
 }
 return s;
}
export const names=["contracts.ts","client.ts","decoders.ts","HostedGovernance.tsx","verification.ts"];
if(process.argv[1]===fileURLToPath(import.meta.url))for(const name of names)console.log(JSON.stringify({name,bytes:Buffer.byteLength(transformed(name))}));
