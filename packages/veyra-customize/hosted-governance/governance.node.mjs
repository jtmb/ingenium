import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createHash} from "node:crypto";
import {fixture,baseSkill,baseProposal,baseStatus,originalBinding} from "./__tests__/fixture.ts";
import {bindingKey,createGovernanceClient,decodeSkill,descriptor,recoveryOwnerKey} from "./client.ts";
import * as decode from "./decoders.ts";
import {adaptSkillResult,normalizeOriginalRefusal} from "./writeOutcome.ts";
import {recoveredSaveResult,receiptMatchesDraft,skillMatchesOriginal} from "./verification.ts";
import {runSkillSave,runSkillUpload,skillWriteBlocked,verifySkillSave} from "./skill-write-outcomes.mjs";
const target={id:baseSkill.id,revision:baseSkill.revision};
test("closed HTTP descriptors retain exact namespace and actual methods without an origin or token",()=>{
  const b={...originalBinding,apiProject:"actual /?namespace"};
  const r=descriptor({op:"save",filePath:"SKILL.md",name:"safe name",target,content:"# New",extra:{always_apply:0,files:baseSkill.file_tree}},b);
  assert.equal(r.method,"PATCH");assert.equal(new URL("https://fixture.invalid"+r.path).searchParams.get("project"),b.apiProject);
  assert.equal(r.path.split("?")[0],"/api/v1/skills/safe%20name");
  assert.deepEqual(Object.keys(r.body).sort(),["always_apply","content","files","tags"]);assert.ok(!JSON.stringify(r).includes("expected_revision"));
});
test("unknown operations and unsafe identities cannot reserve or dispatch",async()=>{
  const {transport,state}=fixture(),client=createGovernanceClient(transport);
  await assert.rejects(client.mutate({op:"fetch-url",url:"https://untrusted.invalid"}),/allowlisted/);
  await assert.rejects(client.mutate({op:"archive",name:"../escape",target}),/exact skill/);
  await assert.rejects(client.mutate({op:"save",filePath:"SKILL.md",name:"release",content:"x",extra:{always_apply:0}}),/metadata/);
  assert.equal(state.reservations.length,0);assert.equal(state.sends.length,0);
});
test("projectless native binding keeps the explicit real hosted owner and never picks a global project",()=>{
  const b={...originalBinding,nativeProjectId:null,nativeProjectRevision:null};
  assert.notEqual(bindingKey(b),bindingKey(originalBinding));
  assert.equal(new URL("https://fixture.invalid"+descriptor({op:"archived"},b).path).searchParams.get("project"),b.apiProject);
  assert.throws(()=>bindingKey({...b,actorId:""}),/original hosted/);
  assert.throws(()=>bindingKey({...b,hostedProjectId:""}),/original hosted/);
});
test("a crossed read envelope is rejected without another source or retry",async()=>{
  const {transport,state}=fixture();transport.read=async command=>{state.reads.push(command);return {binding:{...originalBinding,actorId:"other"},value:{data:baseSkill}};};
  await assert.rejects(createGovernanceClient(transport).skill("release"),/Cross-owner/);assert.equal(state.reads.length,1);
});
test("revocation during a read never returns old protected rows",async()=>{
  const {transport,state}=fixture();let complete;transport.read=()=>new Promise(resolve=>{complete=resolve;});
  const action=createGovernanceClient(transport).skill("release");state.active=false;complete({binding:originalBinding,value:{data:baseSkill}});
  await assert.rejects(action,/authority changed/);assert.equal(state.sends.length,0);
});
test("one retained original precedes dispatch and an unknown write is not replayed",async()=>{
  const {transport,state}=fixture();state.send=async original=>({original,outcome:"unknown",error:{message:"Connection lost"}});
  const client=createGovernanceClient(transport),first=await client.mutate({op:"archive",name:"release",target});
  assert.equal(first.outcome,"unknown");assert.deepEqual(state.events,["reserve","send"]);
  await client.inspect(first.original);assert.equal(state.inspections.length,1);assert.equal(state.sends.length,1);
  await assert.rejects(client.mutate({op:"disable",name:"release",target}),/existing original/);assert.equal(state.reservations.length,1);
});
test("owner change after reservation retains the original but prevents dispatch",async()=>{
  const {transport,state}=fixture();state.reserveHook=()=>{state.active=false;};
  await assert.rejects(createGovernanceClient(transport).mutate({op:"archive",name:"release",target}),/authority changed/);
  assert.equal(state.reservations.length,1);assert.equal(state.originals.length,1);assert.equal(state.sends.length,0);
});
test("a forged receipt cannot confirm another original",async()=>{
  const {transport,state}=fixture();state.send=async original=>({original:{...original,id:"foreign"},outcome:"succeeded",value:{data:baseSkill}});
  const result=await createGovernanceClient(transport).mutate({op:"archive",name:"release",target});
  assert.equal(result.outcome,"unknown");assert.match(result.error.message,/does not match/);assert.equal(state.sends.length,1);
});
test("foreign pending originals block a new write without lookup or deletion",async()=>{
  const {transport,state}=fixture();state.originals=[{id:"foreign",binding:{...originalBinding,installationId:"other"},command:{op:"archive",name:"release",target}}];
  await assert.rejects(createGovernanceClient(transport).mutate({op:"archive",name:"release",target}),/foreign/);
  assert.equal(state.inspections.length,0);assert.equal(state.reservations.length,0);assert.equal(state.originals.length,1);
});
test("capability denial is enforced before retaining a new original",async()=>{
  const {transport,state}=fixture();transport.capabilities=["catalog"];
  await assert.rejects(createGovernanceClient(transport).mutate({op:"archive",name:"release",target}),/unavailable/);
  assert.equal(state.reservations.length,0);
});
test("binding mutation and local reader disposal fence both read and dispatch",async()=>{
  const {transport,state}=fixture();let current=true;const client=createGovernanceClient(transport,()=>current);
  current=false;await assert.rejects(client.skill("release"),/authority changed/);assert.equal(state.reads.length,0);
  current=true;transport.binding={...transport.binding,hostedServiceInstanceId:"restarted"};
  assert.equal(client.current(),false);await assert.rejects(client.mutate({op:"archive",name:"release",target}),/authority changed/);
});
test("full catalog preserves disabled installed metadata and original identifiers",async()=>{
  const {transport,state}=fixture(),rows=await createGovernanceClient(transport).catalog();
  assert.equal(rows[0].id,baseSkill.id);assert.equal(rows[0].installed,true);assert.equal(rows[0].enabled,false);assert.equal(rows[0].revision,3);
  assert.deepEqual(state.reads.map(v=>v.op),["catalog"]);
});
test("crossed catalog scope and unstable pagination never become empty success",async()=>{
  const {transport,state,response}=fixture();state.reply=c=>{const r=response(c);return c.op==="catalog"?{...r,scope:{kind:"project",projectId:"other"}}:r;};
  await assert.rejects(createGovernanceClient(transport).catalog(),/scope differs/);
  state.reply=c=>c.op==="catalog"?{scope:{kind:"project",projectId:originalBinding.hostedProjectId},scopes:["project"],data:[],pagination:{offset:c.offset,limit:100,total:2,hasMore:true}}:response(c);
  await assert.rejects(createGovernanceClient(transport).catalog(),/did not advance/);
});
test("skill records cannot cross projects; reference edits keep body tags and neighbors",async()=>{
  assert.throws(()=>decodeSkill({...baseSkill,project_id:"other"},originalBinding),/original project/);
  const {transport,state}=fixture(),client=createGovernanceClient(transport);
  const result=await runSkillSave(baseSkill,"references/check.md","# Changed",originalBinding.apiProject,{
    write:async(name,payload)=>client.mutate({op:"save",filePath:"references/check.md",name,target,content:payload.content,extra:payload.extra}),read:name=>client.skill(name)});
  assert.equal(result.status,"verified");assert.equal(state.skills[0].content,baseSkill.content);assert.equal(state.skills[0].tags,baseSkill.tags);
  assert.equal(JSON.parse(state.skills[0].file_tree)["references/check.md"],"# Changed");assert.deepEqual(state.sends[0].command.target,target);
});
test("actual proposal IDs revisions comparisons and grounding survive decoding",()=>{
  const p=decode.proposal({data:baseProposal},originalBinding,baseProposal.id);
  assert.equal(p.targetSkillId,baseSkill.id);assert.equal(p.expectedRevision,3);assert.deepEqual(p.observationIds,[12]);assert.equal(p.currentSkill.content,"# Original");
  assert.throws(()=>decode.proposal({data:{...baseProposal,projectId:"other"}},originalBinding,baseProposal.id),/original hosted/);
  assert.throws(()=>decode.proposalPage({data:Array(26).fill(baseProposal),pagination:{hasMore:false,nextCursor:null}}),/bounded/);
});
test("proposal review metadata is retained but never invented in the legacy HTTP body",()=>{
  const c={op:"approve",id:baseProposal.id,reviewed:{status:"pending",updatedAt:baseProposal.updatedAt,targetSkillId:baseProposal.targetSkillId,sourceProjectId:baseProposal.sourceProjectId,sourceName:baseProposal.sourceName,expectedRevision:3,expectedSourceRevision:null},reviewer:"Actual reviewer",reason:"Grounded"};
  const r=descriptor(c,originalBinding);assert.equal(r.method,"POST");assert.deepEqual(r.body,{reviewer:"Actual reviewer",reason:"Grounded"});
  assert.throws(()=>descriptor({...c,reviewed:undefined},originalBinding),/metadata is not allowlisted/);
});
test("synthesis acknowledgement is a trigger, not batch completion or a changed default",async()=>{
  const {transport,state}=fixture(),receipt=await createGovernanceClient(transport).mutate({op:"synthesis-run"});
  assert.equal(receipt.value.data.status,"started");assert.deepEqual(descriptor({op:"synthesis-run"},originalBinding).body,{});
  assert.deepEqual(descriptor({op:"synthesis-run",model:{providerId:"existing-provider",modelId:"existing-model"}},originalBinding).body,{model:{providerId:"existing-provider",modelId:"existing-model"}});
  assert.equal(decode.synthesisStatus({data:baseStatus}).pending_count,1);assert.equal(baseStatus.last_synthesis_at,null);assert.equal(state.sends.length,1);
});
test("model catalog and pipeline decode only original-owner metadata",()=>{
  assert.equal(decode.modelProviders({data:{providers:[{providerId:"actual",label:"Actual",models:[{id:"model",label:"Model"}]}]}})[0].models[0].id,"model");
  assert.throws(()=>decode.pipeline({data:[{id:1,project_id:"other",event_type:"synthesis_started",event_source:"synthesis",title:"Started",created_at:"now"}]},originalBinding),/original-project/);
});
test("Root confirmed create with malformed response remains confirmed and blocks replay",async()=>{
  const result=await runSkillUpload("---\nname: new-skill\ndescription: New\n---\n# New",originalBinding.apiProject,{
    create:async()=>{throw new Error("Malformed successful response");},refresh:async()=>true});
  const command={op:"create",reviewedAbsent:true,name:"new-skill",description:"New",content:"# New"};
  const adapted=adaptSkillResult(result,{original:{id:"known",binding:originalBinding,command},outcome:"succeeded",value:{bad:true}});
  assert.equal(adapted.status,"saved-refresh-failed");assert.equal(adapted.writeConfirmed,true);assert.equal(skillWriteBlocked(adapted),true);
});
test("Root proven refusal without HTTP status is not misreported as an uncertain write",()=>{
  const error=Object.assign(new Error("Verified permission refusal"),{rootOutcome:"refused"});
  const value=normalizeOriginalRefusal({status:"unknown",message:"Unknown",failure:{original:error}});
  assert.equal(value.status,"refused");assert.match(value.message,/permission refusal/);assert.equal(error.status,undefined);
});
test("C4 failed-save draft and first failure survive explicit read-only verification",async()=>{
  const first=new Error("Readback offline");let writes=0;
  const value=await runSkillSave(baseSkill,"SKILL.md","# Exact draft  \n",originalBinding.apiProject,{write:async()=>{writes++;},read:async()=>{throw first;}});
  assert.equal(value.status,"saved-refresh-failed");assert.equal(value.attempt.text,"# Exact draft  \n");assert.equal(value.failure.original,first);
  const retry=await verifySkillSave(value,{read:async()=>{throw new Error("Still offline");}});
  assert.equal(retry.failure.original,first);assert.equal(writes,1);
});
test("copied C4 runtime remains byte-identical to the declared source helper",()=>{
  const provenance=JSON.parse(fs.readFileSync(new URL("./helper-provenance.json",import.meta.url),"utf8"));
  const bytes=fs.readFileSync(new URL("./skill-write-outcomes.mjs",import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),provenance.sha256);
});

test("malformed terminal receipts retain a local view barrier even if Root omits its pending row",async()=>{
  const {transport,state}=fixture();state.send=async original=>({original:{...original,id:"wrong"},outcome:"succeeded"});
  const client=createGovernanceClient(transport),first=await client.mutate({op:"archive",name:"release",target});
  assert.equal(first.outcome,"unknown");assert.equal((await client.pending()).length,1);
  await assert.rejects(client.mutate({op:"enable",name:"release",target}),/existing original/);
  assert.equal(state.sends.length,1);
});
test("only a matching authoritative receipt resolves a retained uncertain original",async()=>{
  const {transport,state}=fixture();state.send=async original=>({original,outcome:"unknown"});
  const client=createGovernanceClient(transport),first=await client.mutate({op:"archive",name:"release",target});
  state.inspect=async original=>({original,outcome:"succeeded",value:{data:baseSkill}});
  await client.inspect(first.original);assert.equal((await client.pending()).length,0);assert.equal(state.sends.length,1);
});
test("an acknowledged original can refine verified upload evidence without losing its first failure",()=>{
  const failure={original:new Error("Initial disconnect")},attempt={name:"new-skill",description:"New",content:"# New",project:originalBinding.apiProject};
  const r=adaptSkillResult({status:"verified",writeConfirmed:false,message:"Original unknown",failure,attempt},
    {original:{id:"known",binding:originalBinding,command:{op:"create",reviewedAbsent:true,name:attempt.name,description:attempt.description,content:attempt.content}},outcome:"succeeded"});
  assert.equal(r.writeConfirmed,true);assert.equal(r.failure,failure);assert.match(r.message,/confirmed creation/);
});

test("reader refresh can inspect an unchanged original for the same resource owner without replay",async()=>{
  const currentBinding={...originalBinding,epoch:"reader-2",nativeProjectRevision:5,grantRevision:3,apiProject:"renamed-namespace"};
  const {transport,state}=fixture(currentBinding);
  const original={id:"old-original",binding:structuredClone(originalBinding),command:{op:"archive",name:"release",target}};
  state.originals=[original];state.inspect=async preserved=>({original:preserved,outcome:"succeeded"});
  const client=createGovernanceClient(transport);
  assert.equal((await client.pending())[0].binding.epoch,"reader-1");
  await client.inspect(original);
  assert.equal(state.sends.length,0);assert.equal(state.inspections[0].binding.apiProject,"actual-namespace");
  assert.equal(recoveryOwnerKey(originalBinding),recoveryOwnerKey(currentBinding));
});
test("changed actor or actual project is foreign even if the reader epoch matches",()=>{
  assert.notEqual(recoveryOwnerKey(originalBinding),recoveryOwnerKey({...originalBinding,actorId:"other"}));
  assert.notEqual(recoveryOwnerKey(originalBinding),recoveryOwnerKey({...originalBinding,hostedProjectId:"other"}));
});
test("recovered exact reference draft verifies full saved payload and preserves original file selection",()=>{
  const command={op:"save",name:"release",filePath:"references/check.md",target,content:baseSkill.content,extra:{tags:baseSkill.tags,always_apply:0,files:JSON.stringify({"references/check.md":"# Exact reference"})}};
  const receipt={original:{id:"recovered",binding:originalBinding,command},outcome:"succeeded"};
  const actual={...baseSkill,file_tree:command.extra.files,revision:4};
  const result=recoveredSaveResult(receipt,actual);
  assert.equal(result.attempt.path,"references/check.md");assert.equal(result.attempt.text,"# Exact reference");assert.equal(result.status,"verified");
  assert.equal(skillMatchesOriginal({...actual,tags:"concurrent"},command),false);
  assert.equal(receiptMatchesDraft(result,receipt,"save"),true);
  assert.equal(receiptMatchesDraft(result,{...receipt,original:{...receipt.original,command:{op:"archive",name:"release",target}}},"save"),false);
});
test("public binding and closed command reject accidental private transport fields",()=>{
  assert.throws(()=>bindingKey({...originalBinding,credential:"not-a-real-secret"}),/original hosted/);
  assert.throws(()=>descriptor({op:"archived",url:"https://untrusted.invalid"},originalBinding),/allowlisted/);
  assert.throws(()=>descriptor({op:"save",name:"release",filePath:"SKILL.md",target,content:"x",extra:{always_apply:0,headers:{}}},originalBinding),/not allowlisted/);
});

test("basic proposal detail is an explicit bounded choice, never an automatic denied-read fallback",()=>{
  assert.equal(new URL("https://fixture.invalid"+descriptor({op:"proposal",id:baseProposal.id,enrich:false},originalBinding).path).searchParams.get("enrich"),"false");
  assert.equal(new URL("https://fixture.invalid"+descriptor({op:"proposal",id:baseProposal.id},originalBinding).path).searchParams.has("enrich"),false);
  assert.throws(()=>decode.proposal({data:{...baseProposal,sourceProjectId:"source",sourceSkill:{projectId:"wrong",name:"x",content:"private",revision:1}}},originalBinding,baseProposal.id),/source skill comparison/);
});
