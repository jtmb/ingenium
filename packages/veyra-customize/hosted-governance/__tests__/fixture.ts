import type {Binding,BoundGovernanceTransport,Operation,OperationReceipt,ProposalDetail,ReadCommand,Skill,SynthesisStatus,WriteOriginal} from "../contracts";
export const originalBinding:Binding={authorityId:"authority",connectionId:"connection",grantId:"grant",grantRevision:2,epoch:"reader-1",
  nativeLibraryId:"library",nativeServiceInstanceId:"native-service",hostedServiceInstanceId:"hosted-service",
  nativeProjectId:"native-project",nativeProjectRevision:4,actorId:"actor",installationId:"installation",hostedProjectId:"hosted-project",apiProject:"actual-namespace",visibility:"project"};
export const baseSkill:Skill={id:"skill-id",project_id:"hosted-project",name:"release",description:"Release checks",content:"# Original",
  category:"Delivery",tags:"release",always_apply:0,file_tree:JSON.stringify({"references/check.md":"# Reference"}),enabled:0,
  revision:3,archived_at:null,created_at:"2026-10-30",updated_at:"2026-10-30"};
export const baseProposal:ProposalDetail={id:"proposal-1",status:"pending",proposalType:"update",targetName:"release",sourceName:null,
  qualityScore:.9,noveltyScore:.8,createdAt:"2026-10-30",updatedAt:"2026-10-30",projectId:"hosted-project",targetSkillId:"skill-id",
  sourceProjectId:null,expectedRevision:3,expectedSourceRevision:null,proposedState:{description:"Proposed",content:"# Proposed"},
  evidence:[{kind:"observation",id:12}],observationIds:[12],reviewer:null,reviewReason:null,appliedAt:null,rolledBackAt:null,
  observations:[{id:12,contentPreview:"Grounded observation"}],currentSkill:{content:"# Original",revision:3}};
export const baseStatus:SynthesisStatus={total_observations:4,pending_count:1,processed_count:3,trait_count:0,last_synthesis_at:null,incompleteBatch:null};
/** Deterministic owner fixture only; no operational persistence or production authority. */
export function fixture(binding:Binding=structuredClone(originalBinding)) {
  const state:{active:boolean;skills:Skill[];proposals:ProposalDetail[];originals:WriteOriginal[];reads:ReadCommand[];sends:WriteOriginal[];
    reservations:WriteOriginal[];inspections:WriteOriginal[];events:string[];
    reply?: (c:ReadCommand)=>unknown|Promise<unknown>;send?: (o:WriteOriginal)=>OperationReceipt|Promise<OperationReceipt>;
    inspect?: (o:WriteOriginal)=>OperationReceipt|Promise<OperationReceipt>;reserveHook?:()=>void|Promise<void>;
  }={active:true,skills:[structuredClone({...baseSkill,project_id:binding.hostedProjectId})],proposals:[structuredClone({...baseProposal,projectId:binding.hostedProjectId})],
    originals:[],reads:[],sends:[],reservations:[],inspections:[],events:[]};
  const response=(c:ReadCommand):unknown=>{
    switch(c.op){
      case "catalog": {const rows=state.skills.filter(s=>!s.archived_at).map(s=>({id:s.id,kind:c.kind,name:s.name,description:s.description,category:s.category??"Local",visibility:binding.visibility,installed:true,enabled:!!s.enabled,archived:false,revision:s.revision,actions:[]}));return {scope:{kind:"project",projectId:binding.hostedProjectId},scopes:[binding.visibility],data:rows.slice(c.offset,c.offset+c.limit),pagination:{offset:c.offset,limit:c.limit,total:rows.length,hasMore:c.offset+c.limit<rows.length}};}
      case "skill": {const row=state.skills.find(s=>s.name===c.name);if(!row)throw Object.assign(new Error("Not found"),{status:404});return {data:row};}
      case "archived":return {data:state.skills.filter(s=>!!s.archived_at)};
      case "proposal-counts":return {data:{open:state.proposals.filter(p=>["pending","draft"].includes(p.status)).length,history:state.proposals.filter(p=>!["pending","draft"].includes(p.status)).length,byStatus:{pending:1}}};
      case "proposal-page":return {data:state.proposals.filter(p=>c.view==="open"?["pending","draft"].includes(p.status):!["pending","draft"].includes(p.status)),pagination:{nextCursor:null,hasMore:false}};
      case "proposal":return {data:state.proposals.find(p=>p.id===c.id)};
      case "synthesis-status":return {data:baseStatus};
      case "synthesis-models":return {data:{providers:[{providerId:"existing-provider",label:"Existing provider",models:[{id:"existing-model",label:"Existing model"}]}]}};
      case "pipeline":return {data:[{id:1,project_id:binding.hostedProjectId,event_type:"synthesis_started",event_source:"synthesis",title:"Started",created_at:"2026-10-30"}]};
    }
  };
  const finish=(o:WriteOriginal,r:OperationReceipt)=>{if(r.outcome!=="unknown")state.originals=state.originals.filter(v=>v.id!==o.id);return r;};
  const capabilities:Operation[]=["catalog","skill","archived","proposal-counts","proposal-page","proposal","synthesis-status","synthesis-models","pipeline","create","save","archive","restore","enable","disable","approve","reject","rollback","synthesis-run"];
  const transport:BoundGovernanceTransport={binding,capabilities,current:()=>state.active,
    async read(c,b){state.reads.push(structuredClone(c));const value=state.reply?await state.reply(c):response(c);return {binding:structuredClone(b),value:structuredClone(value)};},
    async reserve(c,b){if(state.originals.length)throw new Error("Existing original");const o={id:"original-"+(state.reservations.length+1),binding:structuredClone(b),command:structuredClone(c)};state.events.push("reserve");state.originals.push(o);state.reservations.push(o);await state.reserveHook?.();return structuredClone(o);},
    async send(o){state.events.push("send");state.sends.push(structuredClone(o));if(state.send)return finish(o,await state.send(o));const c=o.command;let value:unknown;
      if(c.op==="create"){const created={...baseSkill,id:"created-"+state.skills.length,project_id:binding.hostedProjectId,name:c.name,description:c.description,content:c.content,revision:0,category:null,tags:null,file_tree:null,enabled:1,archived_at:null};state.skills.push(created);value={data:created};}
      else if("name" in c){const skill=state.skills.find(s=>s.name===c.name);if(!skill)throw new Error("Fixture skill absent");skill.revision++;if(c.op==="save"){skill.content=c.content;skill.tags=c.extra.tags??null;skill.always_apply=c.extra.always_apply;if(c.extra.files!==undefined)skill.file_tree=c.extra.files;}else if(c.op==="archive")skill.archived_at="2026-10-30";else if(c.op==="restore")skill.archived_at=null;else skill.enabled=c.op==="enable"?1:0;value={data:skill};}
      else if(c.op==="synthesis-run")value={data:{status:"started",message:"Trigger only"}};
      else {const p=state.proposals.find(v=>v.id===c.id);if(!p)throw new Error("Fixture proposal absent");p.status=c.op==="approve"?"applied":c.op==="reject"?"rejected":"rolledBack";p.reviewer=c.reviewer;p.reviewReason=c.reason??null;p.appliedAt=c.op==="approve"?"2026-10-30":null;value={data:p};}
      return finish(o,{original:structuredClone(o),outcome:"succeeded",value:structuredClone(value)});},
    async inspect(o){state.inspections.push(o);return finish(o,state.inspect?await state.inspect(o):{original:o,outcome:"unknown",error:{message:"Original is still unknown"}});},
    async pending(){return structuredClone(state.originals);}
  };
  return {state,transport,response};
}
