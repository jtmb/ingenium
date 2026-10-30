import type {OperationReceipt,Skill,WriteCommand} from "./contracts";
import type {SkillWriteResult} from "./skill-write-outcomes.mjs";
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
function tree(v:string|null|undefined):Record<string,unknown>|null {try{const parsed:unknown=JSON.parse(v??"null");return object(parsed)?parsed:null;}catch{return null;}}
function sameTree(a:string|null,b:string):boolean {const x=tree(a),y=tree(b);return !!(x&&y&&Object.keys(x).length===Object.keys(y).length&&Object.keys(x).every(k=>Object.hasOwn(y,k)&&x[k]===y[k]));}
export function skillMatchesOriginal(skill:Skill,command:WriteCommand):boolean {
  if(!("name" in command)||skill.name!==command.name)return false;
  if(command.op==="create")return skill.content===command.content&&skill.description===command.description;
  if(skill.id!==command.target.id)return false;
  if(command.op==="save")return skill.content===command.content&&skill.always_apply===command.extra.always_apply
    &&(command.extra.tags===undefined||skill.tags===command.extra.tags)
    &&(command.extra.files===undefined||sameTree(skill.file_tree,command.extra.files));
  if(command.op==="archive")return !!skill.archived_at;
  if(command.op==="restore")return !skill.archived_at;
  return skill.enabled===(command.op==="enable"?1:0);
}
export function proposalMatchesAction(status:string,op:"approve"|"reject"|"rollback"):boolean {
  return op==="approve"?status==="applied":op==="reject"?status==="rejected":["rolledBack","rolled_back"].includes(status);
}
export function receiptMatchesDraft(result:SkillWriteResult|null,receipt:OperationReceipt|null,kind:"save"|"upload"):boolean {
  const a=result?.attempt,c=receipt?.original.command;
  if(!a||!c||receipt?.original.binding.apiProject!==a.project||!("name" in c)||c.name!==a.name)return false;
  if(kind==="upload")return c.op==="create"&&c.content===a.content&&c.description===a.description;
  if(c.op!=="save"||c.target.id!==a.id||c.filePath!==a.path)return false;
  return a.path==="SKILL.md"?c.content===a.text:tree(c.extra.files)?.[a.path??""]===a.text;
}
export function recoveredSaveResult(receipt:OperationReceipt,skill:Skill):SkillWriteResult {
  const c=receipt.original.command;
  if(receipt.outcome!=="succeeded"||c.op!=="save"||skill.project_id!==receipt.original.binding.hostedProjectId||!skillMatchesOriginal(skill,c))throw new Error("The retained save target does not match its acknowledged payload.");
  const text=c.filePath==="SKILL.md"?c.content:tree(c.extra.files)?.[c.filePath];
  if(typeof text!=="string")throw new Error("The retained original has no exact selected-file draft.");
  return {status:"verified",writeConfirmed:true,message:"Retained original payload and selected-file draft read back; no save was replayed.",
    attempt:{id:c.target.id,projectId:skill.project_id,project:receipt.original.binding.apiProject,name:c.name,path:c.filePath,text},record:skill};
}
