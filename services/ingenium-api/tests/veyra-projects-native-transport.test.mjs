import test from "node:test";
import assert from "node:assert/strict";
import {NativeWorkspaceTransport,terminalRequestFingerprint} from "../lib/projects-v2/native-transport.mjs";
import {NativeProjectCatalogAdapter} from "../lib/projects-v2/native-catalog.mjs";

const projectId="11111111-1111-4111-8111-111111111111";
const instanceId="22222222-2222-4222-8222-222222222222";
const operationId="33333333-3333-4333-8333-333333333333";
const terminalId="44444444-4444-4444-8444-444444444444";
const scope={instanceId:"installation",organizationId:"org",ownerUserId:"alice"};
const binding={version:1,id:"bound",hostId:"pc",environmentId:"native",workspaceBindingId:"mapping",
  canonicalRootId:"file-id",directory:"C:/repo",shellId:"powershell",securityEpoch:3,kind:"windows",
  workspaceIdentity:"inode",mappingHash:"a".repeat(64),ownerInstanceId:instanceId,ownerRevision:5};
const owner={project_id:projectId,project_revision:5,service_instance_id:instanceId,environment:{kind:"windows"}};
const gitOwner={...owner,cwd:"C:/repo",execution_cwd:"C:/repo",worktree:"C:/repo",git_dir:"C:/repo/.git"};
function fixture(reply) {
  const calls=[];
  const client=new NativeWorkspaceTransport({authorize:async()=>true,
    transport:async request=>{calls.push(request);return {status:200,instanceId,data:await reply(request)};}});
  return {client,calls};
}
function terminalReceipt(request,kind="input") {
  return {request_id:operationId,owner,kind,terminal_id:kind==="create"?terminalId:terminalId,
    state:"succeeded",terminal:null,message:"Native receipt"};
}
test("native catalog adapter mounts actual routes, omits empty cursor and retains source identity",async()=>{
  const nativeProject={id:projectId,name:"Repo",environment:{kind:"windows"},primary_root:"C:/repo",
    roots:["C:/repo"],revision:5,archived:false,pinned:false};
  const f=fixture(async request=>{
    if(request.method==="GET" && request.path==="/v1/projects")return {projects:[nativeProject],next_cursor:null};
    if(request.method==="POST")return {...nativeProject,name:request.body.name,revision:6};
    return nativeProject;
  });
  const catalog=new NativeProjectCatalogAdapter({owner:f.client.projectOwner(),instanceId,
    authorize:async()=>true,resolveRoot:async(s,{directory})=>({id:"root",canonicalRootId:"file-id",
      hostId:"pc",environmentId:"native",directory})});
  assert.equal((await catalog.list(scope)).data[0].id,projectId);
  assert.equal(Object.hasOwn(f.calls[0].query,"after"),false);
  const renamed=await catalog.update(scope,projectId,5,{label:"Renamed"});
  assert.equal(renamed.revision,6);
  assert.equal(f.calls[1].path,"/v1/projects/"+projectId);
  assert.deepEqual(f.calls[1].body,{expected_revision:5,name:"Renamed"});
  assert.equal(f.calls[1].expectedInstanceId,instanceId);
});
test("terminal dispatch uses ConPTY exact request routes and never saves defaults",async()=>{
  const f=fixture(async request=>terminalReceipt(request,"create"));
  const result=await f.client.terminalDispatch({scope,projectId,binding,operationId,action:"terminal.open",
    args:{columns:100,rows:30}});
  assert.equal(result.state,"succeeded");
  assert.equal(f.calls[0].path,"/v1/interactive-terminals/");
  assert.deepEqual(f.calls[0].body,{owner,request_id:operationId,columns:100,rows:30,
    shell:"powershell",save_default:false,expected_default_revision:null});
  assert.equal(f.calls[0].redirect,"error");
});
test("terminal input and resize retain exact bytes and original request IDs",async()=>{
  const f=fixture(async request=>terminalReceipt(request,request.path.endsWith("resize")?"resize":"input"));
  await f.client.terminalDispatch({scope,projectId,binding,operationId,action:"terminal.input",
    args:{terminalId,data:"echo exact\r"}});
  assert.deepEqual(f.calls[0].body,{owner,request_id:operationId,text:"echo exact\r"});
  await f.client.terminalDispatch({scope,projectId,binding,operationId,action:"terminal.resize",
    args:{terminalId,columns:120,rows:40}});
  assert.equal(f.calls[1].path,"/v1/interactive-terminals/"+terminalId+"/resize");
  assert.equal(f.calls[1].body.columns,120);
});
test("native terminal receipt without exact-original proof remains unknown and performs GET only",async()=>{
  const f=fixture(async request=>terminalReceipt(request));
  const result=await f.client.terminalReceipt({scope,projectId,binding,operationId,action:"terminal.input",
    args:{terminalId,data:"original"}});
  assert.equal(result.state,"unknown");
  assert.equal(result.result.code,"NATIVE_TERMINAL_ORIGINAL_UNVERIFIED");
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,"GET");
});
test("proposed native original-proof extension settles only matching originals",async()=>{
  const input={scope,projectId,binding,operationId,action:"terminal.input",args:{terminalId,data:"original"}};
  let proof;
  const f=fixture(async request=>({...terminalReceipt(request),original_sha256:proof}));
  proof=terminalRequestFingerprint(f.client.terminalRequest(input).body,terminalId);
  assert.equal((await f.client.terminalReceipt(input)).state,"succeeded");
  proof=terminalRequestFingerprint({...f.client.terminalRequest(input).body,text:"other input"},terminalId);
  await assert.rejects(()=>f.client.terminalReceipt(input),e=>e.code==="OPERATION_CONFLICT");
});
test("native projectless and cluster requests refuse before transport without scratch/global fallback",async()=>{
  const f=fixture(async()=>({}));
  await assert.rejects(()=>f.client.terminalDispatch({scope,projectId:null,binding,operationId,
    action:"terminal.open",args:{}}),e=>e.code==="NATIVE_PROJECTLESS_UNSUPPORTED");
  const cluster={...binding,kind:"cluster",runtimeId:"runtime",storageId:"storage"};
  await assert.rejects(()=>f.client.terminalDispatch({scope,projectId,binding:cluster,operationId,
    action:"terminal.open",args:{}}),e=>e.code==="NATIVE_ENVIRONMENT_UNSUPPORTED");
  assert.equal(f.calls.length,0);
});
test("Git changes forward the complete confirmed native original and recover by GET",async()=>{
  const original={owner:gitOwner,request_id:operationId,head:"a".repeat(40),branch:"main",index_tree:"opaque-index",
    base:"main",base_commit:"b".repeat(40),confirmed:true,operation:{kind:"commit",message:"Reviewed text"}};
  const f=fixture(async request=>({original:request.body??original,state:"succeeded",message:"Saved",result:null}));
  assert.equal((await f.client.submitReviewed({scope,projectId,binding,domain:"change",original})).state,"succeeded");
  assert.equal(f.calls[0].path,"/v1/git-review/operations");assert.deepEqual(f.calls[0].body,original);
  await f.client.reviewedReceipt({scope,projectId,binding,domain:"change",original});
  assert.equal(f.calls[1].method,"GET");assert.equal(f.calls.length,2);
  await assert.rejects(()=>f.client.submitReviewed({scope,projectId,binding,domain:"change",
    original:{...original,confirmed:false}}),e=>e.code==="EXPLICIT_GIT_CONFIRMATION_REQUIRED");
  assert.equal(f.calls.length,2);
});
test("Git owner mismatch, permission denial and changed service instance do not bypass authority",async()=>{
  const f=fixture(async()=>({}));
  const original={owner:{...gitOwner,project_id:terminalId},request_id:operationId,confirmed:true,
    operation:{kind:"commit",message:"No"}};
  await assert.rejects(()=>f.client.submitReviewed({scope,projectId,binding,domain:"change",original}),
    e=>e.code==="NATIVE_OWNER_MISMATCH");assert.equal(f.calls.length,0);
  f.client.authorize=async()=>false;
  await assert.rejects(()=>f.client.projectOwner().getProject({scope,projectId,expectedInstanceId:instanceId}),
    e=>e.code==="FORBIDDEN");assert.equal(f.calls.length,0);
  f.client.authorize=async()=>true;
  f.client.transport=async()=>({status:200,instanceId:terminalId,data:{}});
  await assert.rejects(()=>f.client.projectOwner().getProject({scope,projectId,expectedInstanceId:instanceId}),
    e=>e.code==="NATIVE_INSTANCE_CHANGED");
});
test("native byte-cursor output is preserved without synthetic chunk conversion",async()=>{
  const f=fixture(async()=>({id:terminalId,owner,sequence:73,output:"latest",output_base64:"bGF0ZXN0",truncated:true}));
  const result=await f.client.terminalRead({scope,projectId,binding,terminalId,after:68});
  assert.equal(result.sequence,73);assert.equal(result.output_base64,"bGF0ZXN0");
  assert.equal(f.calls[0].query.after,68);assert.equal(Object.hasOwn(result,"chunks"),false);
});
test("worktree preview delegates canonical original generation to native owner",async()=>{
  const original={owner:gitOwner,request_id:operationId,task_session_id:null,head:"a".repeat(40),
    base:"main",base_commit:"b".repeat(40),branch:"codex/isolated",destination:"C:/isolated"};
  const f=fixture(async()=>({original}));
  assert.deepEqual(await f.client.previewReviewed({scope,projectId,binding,domain:"worktree",
    selection:{base:"main",branch:"codex/isolated",destination:"C:/isolated"}}),{original});
  assert.equal(f.calls[0].path,"/v1/git-review/worktrees/preview");
  assert.equal(f.calls[0].body.service_instance_id,instanceId);
});

test("terminal fingerprint matches the proposed Rust pure golden fixture without revealing text",()=>{
  const body={owner,request_id:operationId,text:"exact é\r"};
  assert.equal(terminalRequestFingerprint(body,terminalId),
    "4d408e101613853fe5352b043b9fc636dc33c205fde27f59619733239a0958c5");
});
test("reviewed stage and publication bodies preserve patch, remote and PR text byte-for-byte",async()=>{
  const cases=[
    {kind:"stage_hunk",path:"src/a.ts",working_hash:"c".repeat(64),index_hash:"d".repeat(64),patch:"@@ exact\r\n+é\r\n"},
    {kind:"push",remote:"origin",push_url:"https://example.test/owner/repo.git",branch:"codex/reviewed"},
    {kind:"create_pull_request",remote:"origin",push_url:"https://example.test/owner/repo.git",
      repository:"owner/repo",branch:"codex/reviewed",base_branch:"main",title:"Exact title",body:"Line one\r\nLine two"},
  ];
  const f=fixture(async request=>({original:request.body,state:"pending",message:"Retained"}));
  for(const operation of cases) {
    const original={owner:gitOwner,request_id:operationId,head:"a".repeat(40),branch:"main",
      index_tree:"opaque",base:"main",base_commit:"b".repeat(40),confirmed:true,operation};
    assert.equal((await f.client.submitReviewed({scope,projectId,binding,domain:"change",original})).state,"pending");
    assert.deepEqual(f.calls.at(-1).body,original);
    assert.equal(Object.isFrozen(f.calls.at(-1).body.operation),true);
  }
  assert.equal(f.calls.length,3);
});
