import { createHash } from "node:crypto";
import { canonical, payloadHash, type Row, type SqlDb } from "./hosted-governance.js";
import type { SkillProjectionObserver, SkillProjectionWitness } from "./skills.js";

/** Conservative allowlist from current authoritative SQL and reviewed original, not renderer paths. */
export function deriveHostedProjectionPlan(db: SqlDb, original: Row): Row {
  const command=original.command,project=original.binding.hostedProjectId,entries: Row[]=[];
  const skill=(projectId: string,name: string)=>db.prepare("SELECT * FROM skills WHERE project_id=? AND name=?").get(projectId,name);
  const digest=(value: unknown)=>createHash("sha256").update(canonical(value)).digest("hex");
  function entry(projectId: string,name: string,current: Row|undefined,states: Row[],remove=false): void {
    const paths=new Map<string,Row>();
    const add=(action:string,path:string)=>paths.set(action+":"+path,{action,relativePath:path});
    if(remove)add("remove","SKILL.md");
    else {
      add("mkdir","");add("write","SKILL.md");add("write","metadata.json");
      for(const state of states)for(const value of [state.file_tree,state.file_tree_patch]) {
        if(value==null)continue;
        const tree=JSON.parse(value);
        if(!tree||typeof tree!=="object"||Array.isArray(tree))throw new Error("Invalid projection plan tree");
        for(const path of Object.keys(tree)) {
          // Unsafe paths are never authorized; the original owner must reject them.
          if(!path || path.includes("\\")||path.startsWith("/")||path.includes("\0")||path.split("/").some(p=>p===".."||p===""))continue;
          add("mkdir",path);add("write",path);add("remove",path);
        }
      }
    }
    entries.push({projectId,skillId:current?.id??null,name,
      revision:current?current.revision+1:0,paths:[...paths.values()],stateDigests:states.map(state=>digest({
        content:state.content??null,description:state.description??null,tags:state.tags??null,
        alwaysApply:state.always_apply??null,fileTree:state.file_tree??null,fileTreePatch:state.file_tree_patch??null}))});
  }
  if(["submit","reject"].includes(command.op)) { /* No filesystem actions. */ }
  else if(command.name) {
    const current=skill(project,command.name);
    const next=command.op==="create"?{description:command.description,content:command.content}
      :command.op==="save"?{...current,content:command.content,tags:command.extra.tags??current?.tags,
        always_apply:command.extra.always_apply,file_tree:command.extra.files??current?.file_tree}:current??{};
    entry(project,command.name,current,[next],["archive","disable"].includes(command.op));
  } else {
    const proposal=db.prepare("SELECT * FROM skill_proposals WHERE id=? AND project_id=?").get(command.id,project);
    if(!proposal)throw new Error("Projection plan proposal unavailable");
    const target=skill(project,proposal.target_name);
    if(command.op==="approve") {
      const state=JSON.parse(proposal.proposed_state);
      entry(project,proposal.target_name,target,[target??{},state],proposal.proposal_type==="archive");
      if(proposal.proposal_type==="merge")entry(proposal.source_project_id,proposal.source_name,
        skill(proposal.source_project_id,proposal.source_name),[],true);
    } else if(command.op==="rollback") {
      const version=(id:string,revision:number)=>db.prepare("SELECT * FROM skill_versions WHERE skill_id=? AND revision=?").get(id,revision);
      const remove=proposal.proposal_type==="create"||!!proposal.target_created;
      const previous=remove?undefined:version(proposal.target_skill_id,proposal.target_revision_before);
      if(!remove&&!previous)throw new Error("Projection plan target version unavailable");
      entry(project,previous?.name??proposal.target_name,target,[previous??{}],remove||!!previous?.archived_at);
      if(proposal.proposal_type==="merge") {
        const source=skill(proposal.source_project_id,proposal.source_name);
        const prior=source&&version(source.id,proposal.source_revision_before);
        if(!prior)throw new Error("Projection plan source version unavailable");
        entry(proposal.source_project_id,prior.name,source,[prior],!!prior.archived_at);
      }
    } else throw new Error("Unsupported projection plan command");
  }
  const plan={version:1,operationId:original.id,payloadHash:payloadHash(original),entries};
  if(entries.length>2||entries.some(e=>e.paths.length>2048)||Buffer.byteLength(canonical(plan))>262144)throw new Error("Projection plan exceeds evidence limit");
  return plan;
}

/** No DB writes here. Only planned filesystem actions may execute; refusal is always observable. */
export function createHostedProjectionObserver(plan: Row, events: Row[]): SkillProjectionObserver {
  return (event: Readonly<SkillProjectionWitness>)=>{
    if(events.length>=8192||Buffer.byteLength(canonical(event))>4096
      ||Buffer.byteLength(canonical(events))+Buffer.byteLength(canonical(event))>524288)throw new Error("Projection witness exceeds evidence limit");
    const entry=plan.entries.find((e:Row)=>e.projectId===event.projectId&&e.name===event.name
      &&(e.skillId===null||e.skillId===event.skillId)&&e.revision===event.revision);
    if(event.action!=="validate"&&(!entry||!entry.paths.some((p:Row)=>p.action===event.action&&p.relativePath===event.relativePath))) {
      events.push({...event,phase:"failed",code:"UNPLANNED_PROJECTION"});
      throw new Error("Unplanned skill projection refused");
    }
    events.push({...event});
  };
}
